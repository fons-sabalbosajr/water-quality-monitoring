const mongoose = require('mongoose');

const wqmDatasetSchema = new mongoose.Schema(
  {
    year: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    sheets: {
      type: Array,
      default: [],
    },
    sourceFile: {
      type: String,
      default: '',
    },
    importedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WqmDataset', wqmDatasetSchema);
