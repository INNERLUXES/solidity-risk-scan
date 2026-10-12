// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// A made-up wallet that asks who started the transaction instead of who called.
contract OriginWallet {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function pay(address payable to, uint256 amount) external {
        require(tx.origin == owner, "not the owner");
        (bool sent, ) = to.call{value: amount}("");
        require(sent, "send failed");
    }

    function isOwner() external view returns (bool) {
        return tx.origin == owner;
    }

    function onlyPeople() external view {
        require(tx.origin == msg.sender, "contracts not allowed");
    }
}
