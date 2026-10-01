import Decimal from 'decimal.js';

// Foundation Decimal holds at most 38 significant decimal digits. All payroll
// inputs/configuration start as strings; no money uses binary floating point.
Decimal.set({ precision: 38, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -100, toExpPos: 100 });

export { Decimal };
export const decimal = (value: Decimal.Value): Decimal => new Decimal(value);
export const money = (value: Decimal.Value): Decimal => decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
export const truncate = (value: Decimal.Value): Decimal => decimal(value).toDecimalPlaces(2, Decimal.ROUND_DOWN);
