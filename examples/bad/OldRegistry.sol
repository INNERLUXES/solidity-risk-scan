pragma solidity ^0.8.0;

// A made-up registry from before the license line was asked for. The words below are made up for the example and are
// not a recovery phrase of any wallet.
contract OldRegistry {
    string private note = "amber basil cedar delta ember fable grove hazel ivory jungle kettle lemon";
    mapping(bytes32 => address) public entries;

    function register(bytes32 key) external {
        entries[key] = msg.sender;
    }
}
