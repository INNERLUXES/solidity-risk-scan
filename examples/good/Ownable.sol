// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// A made-up base contract for the examples. It keeps one owner and lets only the owner hand the role on.
abstract contract Ownable {
    address public owner;

    error NotOwner();

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function transferOwnership(address next) external onlyOwner {
        owner = next;
    }
}
