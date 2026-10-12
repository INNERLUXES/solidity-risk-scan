// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./Ownable.sol";

// A made-up payout list. Each account pulls what it is owed, so no loop runs over a list that grows; the owner's batch
// takes its accounts as a parameter with a fixed limit.
library Limits {
    uint256 internal constant BATCH = 50;

    function within(uint256 count) internal pure returns (bool) {
        return count <= BATCH;
    }
}

contract Payouts is Ownable {
    mapping(address => uint256) public owed;
    uint256 public total;

    error BatchTooLarge();
    error NothingOwed();

    function credit(address[] calldata accounts, uint256 each) external onlyOwner {
        if (!Limits.within(accounts.length)) revert BatchTooLarge();
        for (uint256 i = 0; i < accounts.length; i++) {
            owed[accounts[i]] += each;
        }
        total += each * accounts.length;
    }

    function claim() external {
        uint256 amount = owed[msg.sender];
        if (amount == 0) revert NothingOwed();
        owed[msg.sender] = 0;
        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "send failed");
    }
}
