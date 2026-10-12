// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// A made-up vault with the mistakes the scan looks for: the ether is sent before the balance is written, the result of
// a call is dropped, and functions that change the state have no check of who calls.
contract LeakyVault {
    address public owner;
    uint256 public fee;
    mapping(address => uint256) public balances;

    constructor() {
        owner = msg.sender;
    }

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "too much");
        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "send failed");
        balances[msg.sender] -= amount;
    }

    function tip(address payable to) external payable {
        to.call{value: msg.value}("");
    }

    function refund(address payable to, uint256 amount) external {
        to.send(amount);
        balances[to] = 0;
    }

    function setFee(uint256 newFee) external {
        fee = newFee;
    }

    function setOwner(address next) public {
        owner = next;
    }

    function initialize(address first) external {
        owner = first;
    }

    function capture(address payable to, uint256 amount) external {
        (bool ok, ) = to.call{value: amount}("");
        fee = amount;
    }

    function pushOut(address payable to) external {
        to.transfer(1 ether);
    }
}
