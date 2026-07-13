const mongoose = require('mongoose');
const { auditFieldSchema } = require('../utils/auditFields');

const busStopSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sequence: { type: Number, required: true, min: 1 },
    distance: { type: Number, default: 0, min: 0 },
    monthlyFee: { type: Number, default: 0, min: 0 }
  },
  { _id: false }
);

const busRouteSchema = new mongoose.Schema(
  {
    routeName: { type: String, required: true, trim: true },
    routeCode: { type: String, required: true, unique: true, trim: true, uppercase: true },
    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },
    vehicleNumber: { type: String, required: true, trim: true },
    driverName: { type: String, required: true, trim: true },
    driverMobile: { type: String, required: true, trim: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    capacity: { type: Number, default: 40, min: 1 },
    feeType: { type: String, enum: ['stop_based', 'fixed'], default: 'stop_based' },
    fixedMonthlyFee: { type: Number, default: 0, min: 0 },
    stops: { type: [busStopSchema], default: [] },
    ...auditFieldSchema
  },
  { timestamps: true }
);

busRouteSchema.index({ status: 1, routeName: 1 });

module.exports = mongoose.model('BusRoute', busRouteSchema);
