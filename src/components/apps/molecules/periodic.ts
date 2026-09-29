/**
 * The periodic table as a shape: all 118 elements and where each one sits on the wall chart.
 *
 * This is deliberately a separate list from the one in `elements.ts`, and the separation is the
 * point. That file holds what the model knows — covalent radii, van der Waals radii,
 * electronegativities, oxidation states — and every entry in it had to be looked up and checked
 * before it could earn its place. This file holds only what an element *is called* and where it
 * is *drawn*, which is true of all of them and costs nothing to write down.
 *
 * So the picker can offer the whole table without pretending to know the chemistry of
 * einsteinium. An element that is in this list and not in the other is drawn greyed out: it
 * exists, it is in its right place, and the builder cannot put one on the screen because it has
 * no radius to draw it at.
 *
 * `row` and `column` are grid positions, not chemistry. Columns are the groups, 1 to 18. Rows 1
 * to 7 are the periods. The lanthanides and actinides belong to periods 6 and 7 but are drawn
 * on rows 9 and 10, detached and below, the way every chart draws them — putting them inline
 * would make the table thirty-two columns wide for the sake of two rows. Row 8 is left empty on
 * purpose and is what makes the gap.
 */

export interface PeriodicCell {
  number: number;
  symbol: string;
  name: string;
  /** Row in the drawn table: 1–7 for the periods, 9 and 10 for the two detached strips. */
  row: number;
  /** Column, 1–18. The detached strips run 3–17. */
  column: number;
}

/** Symbol and name, in order, so the index is the atomic number minus one. */
const NAMES: [string, string][] = [
  ['H', 'Hydrogen'],
  ['He', 'Helium'],
  ['Li', 'Lithium'],
  ['Be', 'Beryllium'],
  ['B', 'Boron'],
  ['C', 'Carbon'],
  ['N', 'Nitrogen'],
  ['O', 'Oxygen'],
  ['F', 'Fluorine'],
  ['Ne', 'Neon'],
  ['Na', 'Sodium'],
  ['Mg', 'Magnesium'],
  ['Al', 'Aluminium'],
  ['Si', 'Silicon'],
  ['P', 'Phosphorus'],
  ['S', 'Sulfur'],
  ['Cl', 'Chlorine'],
  ['Ar', 'Argon'],
  ['K', 'Potassium'],
  ['Ca', 'Calcium'],
  ['Sc', 'Scandium'],
  ['Ti', 'Titanium'],
  ['V', 'Vanadium'],
  ['Cr', 'Chromium'],
  ['Mn', 'Manganese'],
  ['Fe', 'Iron'],
  ['Co', 'Cobalt'],
  ['Ni', 'Nickel'],
  ['Cu', 'Copper'],
  ['Zn', 'Zinc'],
  ['Ga', 'Gallium'],
  ['Ge', 'Germanium'],
  ['As', 'Arsenic'],
  ['Se', 'Selenium'],
  ['Br', 'Bromine'],
  ['Kr', 'Krypton'],
  ['Rb', 'Rubidium'],
  ['Sr', 'Strontium'],
  ['Y', 'Yttrium'],
  ['Zr', 'Zirconium'],
  ['Nb', 'Niobium'],
  ['Mo', 'Molybdenum'],
  ['Tc', 'Technetium'],
  ['Ru', 'Ruthenium'],
  ['Rh', 'Rhodium'],
  ['Pd', 'Palladium'],
  ['Ag', 'Silver'],
  ['Cd', 'Cadmium'],
  ['In', 'Indium'],
  ['Sn', 'Tin'],
  ['Sb', 'Antimony'],
  ['Te', 'Tellurium'],
  ['I', 'Iodine'],
  ['Xe', 'Xenon'],
  ['Cs', 'Caesium'],
  ['Ba', 'Barium'],
  ['La', 'Lanthanum'],
  ['Ce', 'Cerium'],
  ['Pr', 'Praseodymium'],
  ['Nd', 'Neodymium'],
  ['Pm', 'Promethium'],
  ['Sm', 'Samarium'],
  ['Eu', 'Europium'],
  ['Gd', 'Gadolinium'],
  ['Tb', 'Terbium'],
  ['Dy', 'Dysprosium'],
  ['Ho', 'Holmium'],
  ['Er', 'Erbium'],
  ['Tm', 'Thulium'],
  ['Yb', 'Ytterbium'],
  ['Lu', 'Lutetium'],
  ['Hf', 'Hafnium'],
  ['Ta', 'Tantalum'],
  ['W', 'Tungsten'],
  ['Re', 'Rhenium'],
  ['Os', 'Osmium'],
  ['Ir', 'Iridium'],
  ['Pt', 'Platinum'],
  ['Au', 'Gold'],
  ['Hg', 'Mercury'],
  ['Tl', 'Thallium'],
  ['Pb', 'Lead'],
  ['Bi', 'Bismuth'],
  ['Po', 'Polonium'],
  ['At', 'Astatine'],
  ['Rn', 'Radon'],
  ['Fr', 'Francium'],
  ['Ra', 'Radium'],
  ['Ac', 'Actinium'],
  ['Th', 'Thorium'],
  ['Pa', 'Protactinium'],
  ['U', 'Uranium'],
  ['Np', 'Neptunium'],
  ['Pu', 'Plutonium'],
  ['Am', 'Americium'],
  ['Cm', 'Curium'],
  ['Bk', 'Berkelium'],
  ['Cf', 'Californium'],
  ['Es', 'Einsteinium'],
  ['Fm', 'Fermium'],
  ['Md', 'Mendelevium'],
  ['No', 'Nobelium'],
  ['Lr', 'Lawrencium'],
  ['Rf', 'Rutherfordium'],
  ['Db', 'Dubnium'],
  ['Sg', 'Seaborgium'],
  ['Bh', 'Bohrium'],
  ['Hs', 'Hassium'],
  ['Mt', 'Meitnerium'],
  ['Ds', 'Darmstadtium'],
  ['Rg', 'Roentgenium'],
  ['Cn', 'Copernicium'],
  ['Nh', 'Nihonium'],
  ['Fl', 'Flerovium'],
  ['Mc', 'Moscovium'],
  ['Lv', 'Livermorium'],
  ['Ts', 'Tennessine'],
  ['Og', 'Oganesson'],
];

/**
 * Where atomic number `z` is drawn.
 *
 * The table is a picture of the order the shells fill in, and the gaps in it are the shells
 * that have not opened yet: period 2 jumps from beryllium in group 2 to boron in group 13
 * because there is no d block until period 4. Every branch below is one of those jumps.
 */
function place(z: number): { row: number; column: number } {
  if (z === 1) return { row: 1, column: 1 };
  if (z === 2) return { row: 1, column: 18 };
  if (z <= 10) return { row: 2, column: z <= 4 ? z - 2 : z + 8 };
  if (z <= 18) return { row: 3, column: z <= 12 ? z - 10 : z };
  if (z <= 36) return { row: 4, column: z - 18 };
  if (z <= 54) return { row: 5, column: z - 36 };
  if (z <= 56) return { row: 6, column: z - 54 };
  // Lanthanum to lutetium, lifted out of period 6 and set down on its own strip.
  if (z <= 71) return { row: 9, column: z - 54 };
  if (z <= 86) return { row: 6, column: z - 68 };
  if (z <= 88) return { row: 7, column: z - 86 };
  // Actinium to lawrencium, the same trick one period lower.
  if (z <= 103) return { row: 10, column: z - 86 };
  return { row: 7, column: z - 100 };
}

export const PERIODIC: readonly PeriodicCell[] = NAMES.map(([symbol, name], index) => ({
  number: index + 1,
  symbol,
  name,
  ...place(index + 1),
}));
