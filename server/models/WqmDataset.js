const mongoose = require('mongoose');

const wqmDatasetSchema = new mongoose.Schema(
  {
    year: {
      type: Number,
      required: true,
      // `unique` already creates the index; adding `index: true` as well made
      // Mongoose emit a duplicate-index warning and build it twice.
      unique: true,
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
