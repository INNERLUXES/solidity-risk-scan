// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// A made-up shim that forwards to code at another address, and can end itself.
contract UpgradeShim {
    address public admin;
    address public implementation;

    constructor() {
        admin = msg.sender;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "not admin");
        _;
    }

    function forward(address target, bytes calldata data) external {
        (bool ok, ) = target.delegatecall(data);
        require(ok, "call failed");
    }

    function run(bytes calldata data) external {
        (bool ok, ) = implementation.delegatecall(data);
        require(ok, "call failed");
    }

    function runAsAdmin(bytes calldata data) external onlyAdmin {
        (bool ok, ) = implementation.delegatecall(data);
        require(ok, "call failed");
    }

    function close(address payable to) external {
        selfdestruct(to);
    }

    function closeAsAdmin(address payable to) external onlyAdmin {
        selfdestruct(to);
    }

    function poke(address target, bytes calldata data) external onlyAdmin {
        assembly {
            let ok := delegatecall(gas(), target, add(data.offset, 0), data.length, 0, 0)
            if iszero(ok) { revert(0, 0) }
        }
    }
}
