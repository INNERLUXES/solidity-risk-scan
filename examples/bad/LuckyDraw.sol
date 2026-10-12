// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// A made-up draw that takes its randomness from the block, and a list that grows without limit.
contract LuckyDraw {
    address[] public players;
    uint256 public round;

    function join() external payable {
        players.push(msg.sender);
    }

    function pick() external view returns (address) {
        uint256 index = uint256(keccak256(abi.encodePacked(block.timestamp, block.number, msg.sender))) % players.length;
        return players[index];
    }

    function coin() external view returns (bool) {
        return block.number % 2 == 0;
    }

    function seed() external view returns (bytes32) {
        return keccak256(abi.encode(blockhash(block.number - 1), round));
    }

    function payAll() external {
        for (uint256 i = 0; i < players.length; i++) {
            (bool sent, ) = players[i].call{value: 1 ether}("");
            require(sent, "send failed");
        }
    }

    function count() external view returns (uint256 total) {
        uint256 size = players.length;
        for (uint256 i = 0; i < size; i++) {
            total += 1;
        }
    }
}
