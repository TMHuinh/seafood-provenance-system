// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Seafood Provenance
/// @notice Lưu dấu vết truy xuất nguồn gốc thủy sản (batch, nhật ký nuôi, ...)
///         dưới dạng hash bất biến trên chuỗi.
contract SeafoodProvenance {
    address public owner;
    address public pendingOwner;
    mapping(address => bool) public writers;

    event WriterUpdated(address indexed writer, bool allowed);
    event OwnershipTransferStarted(address indexed owner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor() {
        owner = msg.sender;
        writers[msg.sender] = true;
        emit OwnershipTransferred(address(0), msg.sender);
        emit WriterUpdated(msg.sender, true);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    function setWriter(address writer, bool allowed) external onlyOwner {
        require(writer != address(0), "Zero address");
        writers[writer] = allowed;
        emit WriterUpdated(writer, allowed);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        require(nextOwner != address(0), "Zero address");
        pendingOwner = nextOwner;
        emit OwnershipTransferStarted(owner, nextOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Only pending owner");
        address previousOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, msg.sender);
    }
    struct ChainRecord {
        string dataHash;
        address recordedBy;
        uint256 timestamp;
        uint256 blockNumber;
        uint256 writeCount;
    }

    event DataRecorded(string indexed eventId, string dataHash, address indexed recordedBy, uint256 blockNumber);

    mapping(string => ChainRecord) private _records;

    /// @notice Ghi hash một lần bởi ví đã được cấp quyền.
    /// @param eventId  Mã duy nhất của sự kiện (ví dụ: FARMING_LOG_RECORDED:<logId>).
    /// @param dataHash Hash SHA-256 của dữ liệu.
    function recordData(string calldata eventId, string calldata dataHash) external {
        require(writers[msg.sender], "Writer not authorized");
        require(bytes(eventId).length > 0 && bytes(eventId).length <= 200, "Invalid event ID");
        require(bytes(dataHash).length == 64, "Invalid SHA-256 hash");
        for (uint256 i = 0; i < 64; i++) {
            bytes1 character = bytes(dataHash)[i];
            require((character >= 0x30 && character <= 0x39) || (character >= 0x61 && character <= 0x66), "Invalid SHA-256 hash");
        }
        ChainRecord storage record = _records[eventId];
        require(record.timestamp == 0, "Event already exists");
        record.dataHash = dataHash;
        record.recordedBy = msg.sender;
        record.timestamp = block.timestamp;
        record.blockNumber = block.number;
        record.writeCount = 1;

        emit DataRecorded(eventId, dataHash, msg.sender, block.number);
    }

    /// @notice Lấy toàn bộ bản ghi của một thực thể trên chuỗi (dùng để đối soát).
    function getRecord(string calldata eventId) external view returns (ChainRecord memory) {
        return _records[eventId];
    }

    /// @notice Lấy dataHash (hoặc chuỗi rỗng nếu chưa từng ghi).
    function getDataHash(string calldata eventId) external view returns (string memory) {
        return _records[eventId].dataHash;
    }
}
