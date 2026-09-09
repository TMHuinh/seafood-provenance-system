// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Seafood Provenance
/// @notice Lưu dấu vết truy xuất nguồn gốc thủy sản (batch, nhật ký nuôi, ...)
///         dưới dạng hash bất biến trên chuỗi.
contract SeafoodProvenance {
    struct ChainRecord {
        string dataHash;
        address recordedBy;
        uint256 timestamp;
        uint256 blockNumber;
        uint256 writeCount;
    }

    event DataRecorded(string indexed id, string dataHash, address indexed recordedBy, uint256 blockNumber);

    mapping(string => ChainRecord) private _records;

    /// @notice Ghi hoặc cập nhật hash của một thực thể.
    /// @param id       Mã định danh thực thể (ví dụ: id của nhật ký nuôi).
    /// @param dataHash Hash SHA-256 của dữ liệu.
    function recordData(string calldata id, string calldata dataHash) external {
        ChainRecord storage record = _records[id];
        record.dataHash = dataHash;
        record.recordedBy = msg.sender;
        record.timestamp = block.timestamp;
        record.blockNumber = block.number;
        record.writeCount += 1;

        emit DataRecorded(id, dataHash, msg.sender, block.number);
    }

    /// @notice Lấy toàn bộ bản ghi của một thực thể trên chuỗi (dùng để đối soát).
    function getRecord(string calldata id) external view returns (ChainRecord memory) {
        return _records[id];
    }

    /// @notice Lấy dataHash (hoặc chuỗi rỗng nếu chưa từng ghi).
    function getDataHash(string calldata id) external view returns (string memory) {
        return _records[id].dataHash;
    }
}