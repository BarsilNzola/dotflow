// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUniswapV2Factory {
    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint);

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        require(tokenA != tokenB, "UniswapV2: IDENTICAL_ADDRESSES");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "UniswapV2: ZERO_ADDRESS");
        require(getPair[token0][token1] == address(0), "UniswapV2: PAIR_EXISTS");

        bytes memory bytecode = type(MockUniswapV2Pair).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        assembly {
            pair := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }

        MockUniswapV2Pair(pair).initialize(token0, token1);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);

        emit PairCreated(token0, token1, pair, allPairs.length);
    }
}

contract MockUniswapV2Pair is ERC20 {
    address public token0;
    address public token1;
    uint112 private reserve0;
    uint112 private reserve1;
    uint32  private blockTimestampLast;

    constructor() ERC20("Uniswap V2", "UNI-V2") {}

    function initialize(address _token0, address _token1) external {
        require(token0 == address(0) && token1 == address(0), "Already initialized");
        token0 = _token0;
        token1 = _token1;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, blockTimestampLast);
    }

    function totalSupply() public view override returns (uint256) {
        return super.totalSupply();
    }

    function mint(address to) external returns (uint256 liquidity) {
        liquidity = 1000 * 10 ** 18;
        _mint(to, liquidity);
    }

    function burn(address to) external returns (uint256 amount0, uint256 amount1) {
        amount0 = reserve0;
        amount1 = reserve1;

        _burn(address(this), balanceOf(address(this)));

        reserve0 = 0;
        reserve1 = 0;

        if (amount0 > 0) IERC20(token0).transfer(to, amount0);
        if (amount1 > 0) IERC20(token1).transfer(to, amount1);
    }

    /// @dev 4-argument swap matching the real Uniswap V2 interface and UniswapV2Adapter's IUniswapV2Pair.
    ///      The `data` param is ignored in this mock.
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata /*data*/) external {
        if (amount0Out > 0) {
            require(reserve0 >= amount0Out, "MockPair: insufficient reserve0");
            reserve0 -= uint112(amount0Out);
            IERC20(token0).transfer(to, amount0Out);
        }
        if (amount1Out > 0) {
            require(reserve1 >= amount1Out, "MockPair: insufficient reserve1");
            reserve1 -= uint112(amount1Out);
            IERC20(token1).transfer(to, amount1Out);
        }
    }

    function sync() external {
        reserve0 = uint112(IERC20(token0).balanceOf(address(this)));
        reserve1 = uint112(IERC20(token1).balanceOf(address(this)));
        blockTimestampLast = uint32(block.timestamp);
    }

    function skim(address to) external {
        IERC20(token0).transfer(to, IERC20(token0).balanceOf(address(this)) - reserve0);
        IERC20(token1).transfer(to, IERC20(token1).balanceOf(address(this)) - reserve1);
    }
}

contract MockUniswapV2Router {
    address public factory;
    address public WETH;

    constructor(address _factory, address _WETH) {
        factory = _factory;
        WETH = _WETH;
    }

    function addLiquidity(
        address tokenA, address tokenB,
        uint256 amountADesired, uint256 amountBDesired,
        uint256, uint256,
        address to, uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        require(deadline >= block.timestamp, "UniswapV2Router: EXPIRED");

        IERC20(tokenA).transferFrom(msg.sender, address(this), amountADesired);
        IERC20(tokenB).transferFrom(msg.sender, address(this), amountBDesired);

        address pair = IUniswapV2Factory(factory).getPair(tokenA, tokenB);
        if (pair == address(0)) pair = IUniswapV2Factory(factory).createPair(tokenA, tokenB);

        IERC20(tokenA).transfer(pair, amountADesired);
        IERC20(tokenB).transfer(pair, amountBDesired);

        liquidity = MockUniswapV2Pair(pair).mint(to);
        return (amountADesired, amountBDesired, liquidity);
    }

    function removeLiquidity(
        address tokenA, address tokenB,
        uint256 liquidity, uint256, uint256,
        address to, uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB) {
        require(deadline >= block.timestamp, "UniswapV2Router: EXPIRED");

        address pair = IUniswapV2Factory(factory).getPair(tokenA, tokenB);
        require(pair != address(0), "UniswapV2Router: INVALID_PAIR");

        MockUniswapV2Pair(pair).transferFrom(msg.sender, pair, liquidity);
        (amountA, amountB) = MockUniswapV2Pair(pair).burn(to);
    }

    function swapExactTokensForTokens(
        uint256 amountIn, uint256 amountOutMin,
        address[] calldata path, address to, uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(deadline >= block.timestamp, "UniswapV2Router: EXPIRED");
        require(path.length == 2, "UniswapV2Router: INVALID_PATH");

        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);

        address pair = IUniswapV2Factory(factory).getPair(path[0], path[1]);
        require(pair != address(0), "UniswapV2Router: INVALID_PAIR");

        IERC20(path[0]).transfer(pair, amountIn);

        (uint112 r0, uint112 r1,) = MockUniswapV2Pair(pair).getReserves();
        uint256 amountOut = MockUniswapV2Pair(pair).token0() == path[0]
            ? (amountIn * r1) / (r0 + amountIn)
            : (amountIn * r0) / (r1 + amountIn);

        require(amountOut >= amountOutMin, "UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");

        MockUniswapV2Pair(pair).swap(
            path[1] == MockUniswapV2Pair(pair).token0() ? amountOut : 0,
            path[1] == MockUniswapV2Pair(pair).token1() ? amountOut : 0,
            to,
            ""   // ← 4-arg swap
        );

        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountOut;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external view returns (uint256[] memory amounts)
    {
        require(path.length == 2, "UniswapV2Router: INVALID_PATH");

        address pair = IUniswapV2Factory(factory).getPair(path[0], path[1]);
        require(pair != address(0), "UniswapV2Router: INVALID_PAIR");

        (uint112 r0, uint112 r1,) = MockUniswapV2Pair(pair).getReserves();

        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = MockUniswapV2Pair(pair).token0() == path[0]
            ? (amountIn * r1) / (r0 + amountIn)
            : (amountIn * r0) / (r1 + amountIn);
    }
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
    function createPair(address tokenA, address tokenB) external returns (address pair);
}
