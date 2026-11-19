// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface ITraceBrakeAgentId {
    function balanceOf(address holder) external view returns (uint256);
}

/// @notice 登记本人的 TraceBrake 模拟策略权限。无管理员、无资金入口、无交易能力。
contract TraceBrake {
    address public constant AGENT_ID = address(bytes20(hex"60b9262456de011f7d15a54cdd8c48baaa8b022f"));
    bytes32 public constant POLICY_ID =
        keccak256("TraceBrake/v1:btc-demo:freeze-on-timeout:reconcile-original:no-resubmit");
    uint64 public constant MAX_DURATION = 1 days;

    struct Permission {
        uint64 validUntil;
        bytes32 sessionId;
    }
    mapping(address holder => Permission) private permissions;

    event DemoPermissionGranted(
        address indexed holder, bytes32 indexed policy, bytes32 indexed sessionId, uint64 validUntil
    );
    event DemoPermissionRevoked(address indexed holder, bytes32 indexed policy, bytes32 indexed sessionId);

    error WrongNetwork();
    error NoAgentId();
    error InvalidDuration();
    error InvalidSession();
    error NoPermission();

    constructor() {
        // 正式部署只使用 BNB 智能链主网的官方身份合约。
        if (block.chainid != 56 || AGENT_ID.code.length == 0) revert WrongNetwork();
    }

    /// @notice 只有实际调用地址可以为自己登记权限；没有代授权接口。
    function grantDemoPermission(uint64 durationSeconds, bytes32 sessionId) external {
        if (sessionId == bytes32(0)) revert InvalidSession();
        if (durationSeconds == 0 || durationSeconds > MAX_DURATION) revert InvalidDuration();
        if (ITraceBrakeAgentId(AGENT_ID).balanceOf(msg.sender) == 0) revert NoAgentId();
        uint64 validUntil = uint64(block.timestamp) + durationSeconds;
        permissions[msg.sender] = Permission(validUntil, sessionId);
        emit DemoPermissionGranted(msg.sender, POLICY_ID, sessionId, validUntil);
    }

    /// @notice 即使身份已失效，也允许本人撤回已有授权。
    function revokeDemoPermission() external {
        Permission memory permission = permissions[msg.sender];
        if (permission.validUntil == 0) revert NoPermission();
        delete permissions[msg.sender];
        emit DemoPermissionRevoked(msg.sender, POLICY_ID, permission.sessionId);
    }

    /// @notice 同一次读取返回链上时间、资格和授权状态，客户端无需信任本机时间。
    function permissionState(address holder)
        external view returns (uint64 validUntil, uint64 chainTime, bool hasAgentId, bool active, bytes32 sessionId)
    {
        Permission storage permission = permissions[holder];
        validUntil = permission.validUntil;
        sessionId = permission.sessionId;
        chainTime = uint64(block.timestamp);
        hasAgentId = ITraceBrakeAgentId(AGENT_ID).balanceOf(holder) > 0;
        active = hasAgentId && validUntil > chainTime;
    }
}
