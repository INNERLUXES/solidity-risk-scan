// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IVault {
    function deposit() external payable;

    function withdraw(uint256 amount) external;

    function balances(address account) external view returns (uint256);
}
