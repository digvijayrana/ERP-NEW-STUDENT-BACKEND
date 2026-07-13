const mongoose = require('mongoose');
const { auditFieldSchema } = require('../utils/auditFields');
const { softDeleteFieldSchema, applySoftDeleteMiddleware } = require('../utils/softDeleteFields');

const vehicleDocumentSchema = new mongoose.Schema(
  {
    url: String,
    storageKey: String,
    originalName: String,
    uploadedAt: Date
  },
  { _id: false }
);

// A vehicle record holds both the vehicle details (with document expiries) and the
// assigned driver details (including salary). Selecting a vehicle on a bus route
// auto-fills the vehicle number, capacity and driver contact information.
const vehicleSchema = new mongoose.Schema(
  {
    vehicleNumber: { type: String, required: true, unique: true, trim: true, uppercase: true },
    model: { type: String, trim: true },
    type: { type: String, enum: ['bus', 'van', 'car', 'other'], default: 'bus' },
    capacity: { type: Number, default: 40, min: 1 },

    // Vehicle document expiry tracking
    registrationExpiry: { type: Date },
    insuranceExpiry: { type: Date },
    pollutionExpiry: { type: Date },
    fitnessExpiry: { type: Date },

    // Driver details
    driverName: { type: String, trim: true },
    driverMobile: { type: String, trim: true },
    driverAddress: { type: String, trim: true },
    licenseNumber: { type: String, trim: true },
    licenseExpiry: { type: Date },
    driverSalary: { type: Number, default: 0, min: 0 },
    joiningDate: { type: Date },

    // Mandatory driver documents (photo, Aadhaar, driving license photo)
    documents: {
      driverPhoto: { type: vehicleDocumentSchema, default: undefined },
      driverAadhaar: { type: vehicleDocumentSchema, default: undefined },
      driverLicensePhoto: { type: vehicleDocumentSchema, default: undefined }
    },

    notes: { type: String, trim: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    ...softDeleteFieldSchema,
    ...auditFieldSchema
  },
  { timestamps: true }
);

applySoftDeleteMiddleware(vehicleSchema);

vehicleSchema.index({ status: 1, vehicleNumber: 1 });

vehicleSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Vehicle', vehicleSchema);
