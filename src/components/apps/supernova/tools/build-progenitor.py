#!/usr/bin/env python3
"""Condense a KEPLER presupernova model into the table the simulation starts from.

The input is the s15.0 model from the Garching core-collapse supernova archive, one of the
200 progenitors released with Sukhbold, Ertl, Woosley, Brown & Janka (2016). It is a real
star: 1064 zones carrying radius, density, temperature, electron fraction and a 19-isotope
composition, the end state of a fifteen-solar-mass star evolved from the main sequence to
the moment its iron core gives way.

Using it beats building a progenitor by hand. An earlier version of this simulation stacked
an analytic polytrope under power-law shells, and no amount of tuning made it a star: the
layer masses, the layer radii and hydrostatic equilibrium are not independent things to
choose, and forcing two of them left the third to produce a spike of temperature at the
iron-silicon interface hot enough to burn the silicon before the clock started.

    Usage: build-progenitor.py path/to/s15.0_presn > ../progenitor-data.ts
"""

import sys
import math

M_SUN = 1.989e33

# The model's 19 isotopes plus its lumped iron group, mapped onto the six species the
# simulation tracks. Neon and magnesium go in with oxygen, and sulphur through calcium in
# with silicon: within each group the binding energy per nucleon varies by under 2%, so
# the energy released burning one to the next is what matters and is preserved.
NETWORK = [
    ('neutrons', 'free'), ('H1', 'h'), ('He3', 'he'), ('He4', 'he'),
    ('C12', 'c'), ('N14', 'c'), ('O16', 'o'), ('Ne20', 'o'), ('Mg24', 'o'),
    ('Si28', 'si'), ('S32', 'si'), ('Ar36', 'si'), ('Ca40', 'si'),
    ('Ti44', 'fe'), ('Cr48', 'fe'), ('Fe52', 'fe'), ('Fe54', 'fe'),
    ('Ni56', 'fe'), ('Fe56', 'fe'), ('Fe', 'fe'),
]
SPECIES = ['h', 'he', 'c', 'o', 'si', 'fe', 'free']

# Zone budget, and it is worth explaining why it looks so lopsided.
#
# The explosion is decided in the gain region: the shell between the gain radius, where
# neutrino heating starts to beat neutrino cooling, and the stalled shock a hundred-odd
# kilometres above it. That shell is thin, and in the coordinate this code works in — mass
# — it is tiny, holding on the order of a hundredth of a solar mass. Zones are Lagrangian,
# so resolution has to be committed before the run starts, and the gain region sits just
# above the proto-neutron star's surface, which sweeps from about 1.3 to about 1.7 solar
# masses as it accretes. That half a solar mass therefore gets two thirds of the zones.
#
# An earlier version spread zones evenly through the inner core and the gain region came
# out less than one zone thick. The shock sat inside a single cell two hundred kilometres
# wide, the heating had nothing to act on, and the neutrino heating factor could be moved
# from one to two with no effect whatsoever.
#
# Everything below 1.3 solar masses is excised within milliseconds of bounce and needs only
# enough zones to collapse properly. The hydrogen envelope holds two thirds of the star's
# mass and matters only hours later, when the shock finally reaches it; it is graded by log
# radius, which is the coordinate a shock crosses evenly.
BY_MASS = [(1.30, 60), (1.80, 320), (4.50, 60)]
BY_LOG_RADIUS = 50


def read_model(path):
    zones = []
    for line in open(path):
        head = line.split(':', 1)
        if len(head) < 2 or not head[0].strip().isdigit():
            continue
        f = line.split(':', 1)[1].split()

        def num(i):
            try:
                return float(f[i])
            except ValueError:
                return 0.0

        comp = {}
        for j, (_, species) in enumerate(NETWORK):
            comp[species] = comp.get(species, 0.0) + num(13 + j)
        zone = dict(m=num(0), r=num(1), rho=num(3), t=num(4), ye=num(10))
        zone.update(comp)
        zones.append(zone)
    return zones


def interpolate(zones, key, mass):
    """Value of a field at a mass coordinate, linear in the model's own zoning."""
    lo, hi = 0, len(zones) - 1
    if mass <= zones[0]['m']:
        return zones[0][key]
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if zones[mid]['m'] < mass:
            lo = mid
        else:
            hi = mid
    a, b = zones[lo], zones[hi]
    span = b['m'] - a['m']
    f = 0.0 if span <= 0 else (mass - a['m']) / span
    return a[key] + f * (b[key] - a[key])


def mass_at_radius(zones, radius):
    """Mass coordinate at a radius, linear in log radius so the envelope stays smooth."""
    if radius <= zones[0]['r']:
        return zones[0]['m']
    lo, hi = 0, len(zones) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if zones[mid]['r'] < radius:
            lo = mid
        else:
            hi = mid
    a, b = zones[lo], zones[hi]
    span = math.log(b['r'] / a['r'])
    f = 0.0 if span <= 0 else math.log(radius / a['r']) / span
    return a['m'] + f * (b['m'] - a['m'])


def main():
    zones = read_model(sys.argv[1])
    total = zones[-1]['m']

    # Interface mass coordinates, starting at the centre.
    faces = [0.0]
    start = 0.0
    for upto, count in BY_MASS:
        edge = upto * M_SUN
        for i in range(1, count + 1):
            faces.append(start + (edge - start) * i / count)
        start = edge
    # The envelope: even steps in log radius, converted back to mass coordinate.
    r_start = interpolate(zones, 'r', start)
    r_end = zones[-1]['r']
    for i in range(1, BY_LOG_RADIUS + 1):
        r = math.exp(math.log(r_start) + (math.log(r_end) - math.log(r_start)) * i / BY_LOG_RADIUS)
        faces.append(mass_at_radius(zones, r))
    faces[-1] = total

    radii = [0.0] + [interpolate(zones, 'r', m) for m in faces[1:]]

    # Zone quantities. Density comes from the mass and the radii rather than the model's own
    # value, because the solver derives it that way and the two must agree exactly or the
    # star starts with the wrong mass.
    out = []
    for i in range(len(faces) - 1):
        dm = faces[i + 1] - faces[i]
        volume = (4.0 / 3.0) * math.pi * (radii[i + 1] ** 3 - radii[i] ** 3)
        mid = 0.5 * (faces[i] + faces[i + 1])
        comp = [interpolate(zones, s, mid) for s in SPECIES]
        scale = sum(comp)
        out.append(dict(
            r=radii[i + 1], dm=dm, rho=dm / volume,
            t=interpolate(zones, 't', mid), ye=interpolate(zones, 'ye', mid),
            comp=[c / scale for c in comp],
        ))

    def emit(name, values, fmt='%.6e'):
        body = ', '.join(fmt % v for v in values)
        print('export const %s = [\n  %s,\n];\n' % (name, body.replace(', ', ',\n  ', 0)))

    print('// Generated by tools/build-progenitor.py. Do not edit by hand.')
    print('//')
    print('// Condensed from the s15.0 presupernova model in the Garching core-collapse')
    print('// supernova archive, released with Sukhbold, Ertl, Woosley, Brown & Janka (2016),')
    print('// ApJ 821, 38. A fifteen-solar-mass star at the moment its iron core gives way.')
    print('')
    print('/** Zone count. */')
    print('export const ZONES = %d;' % len(out))
    print('')
    print('/** Outer interface radius of each zone, in cm. */')
    emit('RADIUS', [z['r'] for z in out])
    print('/** Mass of each zone, in g. */')
    emit('ZONE_MASS', [z['dm'] for z in out])
    print('/** Temperature of each zone, in K. */')
    emit('TEMPERATURE', [z['t'] for z in out])
    print('/** Electrons per nucleon in each zone. */')
    emit('YE', [z['ye'] for z in out], '%.5f')
    print('/** Mass fractions, zone by zone, in the order h he c o si fe free. */')
    emit('COMPOSITION', [x for z in out for x in z['comp']], '%.5f')

    sys.stderr.write('%d zones, %.3f Msun, %.4e cm\n' % (len(out), total / M_SUN, radii[-1]))


main()
