// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./Ownable.sol";
import "./IVault.sol";

// A made-up vault that holds ether for the accounts that paid it in. The state is written before the ether is sent, the
// result of the call is used, the function that sends has a lock, and only the owner can pause deposits.
contract Vault is Ownable, IVault {
    uint256 private lockState = 1;
    bool public paused;
    mapping(address => uint256) public balances;

    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);

    error NothingToWithdraw();
    error TransferFailed();

    modifier nonReentrant() {
        require(lockState == 1, "reentrant call");
        lockState = 2;
        _;
        lockState = 1;
    }

    modifier whenNotPaused() {
        require(!paused, "paused");
        _;
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
    }

    function deposit() external payable whenNotPaused {
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external nonReentrant {
        uint256 held = balances[msg.sender];
        if (amount == 0 || held < amount) revert NothingToWithdraw();
        balances[msg.sender] = held - amount;
        (bool sent, ) = msg.sender.call{value: amount}("");
        if (!sent) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }
}
