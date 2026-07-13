require('dotenv').config();

/**
 * Safe, idempotent backfill that moves driver/vehicle data out of the legacy
 * Bus (Transport) module into the dedicated Drivers module (Vehicle collection).
 *
 * What it does (only for records missing the new links):
 *  - For every BusRoute that carries a vehicle number + driver details, ensures a
 *    matching Vehicle record exists (matched by normalized vehicle number). Missing
 *    vehicles are created from the route's driver/vehicle fields.
 *  - Links BusRoute.vehicle -> Vehicle so the route form auto-fills from the fleet.
 *
 * What it intentionally does NOT do:
 *  - It does not delete the denormalized driverName/driverMobile/vehicleNumber that
 *    remain on BusRoute (kept for backward compatibility and existing UI columns).
 *  - It does not upload driver documents (those are captured on new registrations).
 *
 * Usage:
 *   node src/scripts/migrateDriversFromBus.js            # dry-run (reports only)
 *   node src/scripts/migrateDriversFromBus.js --commit   # apply changes
 */

const connectDb = require('../config/db');
const BusRoute = require('../models/BusRoute');
const Vehicle = require('../models/Vehicle');

const COMMIT = process.argv.includes('--commit');

function log(...args) {
  console.log(...args);
}

function normalizeNumber(value) {
  return String(value || '').trim().toUpperCase();
}

async function run() {
  await connectDb();
  log(`\n=== Drivers-from-Bus migration (${COMMIT ? 'COMMIT' : 'DRY-RUN'}) ===\n`);

  const stats = {
    routesScanned: 0,
    vehiclesCreated: 0,
    routesLinked: 0,
    skippedNoVehicleNumber: 0
  };

  const routes = await BusRoute.find({}).select(
    'routeCode vehicle vehicleNumber driverName driverMobile capacity createdBy'
  );

  for (const route of routes) {
    stats.routesScanned += 1;
    const vehicleNumber = normalizeNumber(route.vehicleNumber);
    if (!vehicleNumber) {
      stats.skippedNoVehicleNumber += 1;
      continue;
    }

    let vehicle = await Vehicle.findOne({ vehicleNumber });
    if (!vehicle) {
      stats.vehiclesCreated += 1;
      if (COMMIT) {
        vehicle = await Vehicle.create({
          vehicleNumber,
          type: 'bus',
          capacity: route.capacity || 40,
          driverName: route.driverName,
          driverMobile: route.driverMobile,
          status: 'active',
          createdBy: route.createdBy
        });
      }
    }

    const alreadyLinked = vehicle && route.vehicle && String(route.vehicle) === String(vehicle._id);
    if (vehicle && !alreadyLinked) {
      stats.routesLinked += 1;
      if (COMMIT) {
        route.vehicle = vehicle._id;
        await route.save();
      }
    }
  }

  log('Results:');
  log(JSON.stringify(stats, null, 2));
  log(`\n${COMMIT ? 'Changes applied.' : 'Dry-run complete. Re-run with --commit to apply.'}\n`);
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
