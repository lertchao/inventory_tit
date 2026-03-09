const mongoose = require("mongoose");

const sequenceSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true }, // เช่น MANUAL-ISSUE-202603
    seq: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Sequence", sequenceSchema);