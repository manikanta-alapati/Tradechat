// src/models/Trade.js
const mongoose = require("mongoose"); // <-- direct import

const TradeSchema = new mongoose.Schema(
  {
    phoneNumber: { type: String, index: true, required: true },
    tradeId: { type: String, index: true, required: true, unique: true },
    orderId: { type: String, index: true },
    tradedAt: { type: Date, index: true, required: true },

    tradingsymbol: { type: String, index: true, required: true },
    instrumentType: { type: String, index: true }, // OPTIDX/OPTSTK/OPTCUR/...
    side: { type: String, enum: ["BUY", "SELL"], required: true },
    qty: { type: Number, required: true },
    price: { type: Number, required: true },
    multiplier: { type: Number, default: 1 },
    exchange: { type: String }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Trade || mongoose.model("Trade", TradeSchema);
