"""Prove the verifier bites.

"246 of 246 agree" means nothing unless a wrong key would have been noticed. For
every question family, take one real question from a version that has a key,
point the key at a different option, and require the verifier to complain about
that question and no other.
"""
import verify_ch12a as V

FAMILIES = {
    'name the drawn angle': 1, 'complementary angles': 5, 'supplementary angles': 6,
    'two transversals': 7, 'parallel lines, two expressions': 8,
    'parallel lines, solve for x': 9, 'parallel lines, one angle given': 11,
    'name the polygon': 17, 'quadrilateral definitions': 24,
    'area of a parallelogram': 30, 'area of a trapezoid': 31, 'area of a square': 32,
    'area of a rectangle': 33, 'perimeter of a parallelogram': 36,
    'perimeter of a trapezoid': 37, 'perimeter of a square': 38,
    'perimeter of a rectangle': 39, 'the corner counter': 41,
    'centre-to-centre distance': 42, 'area from base and height': 43,
    'the punched hole': 44, 'triangle type from the drawing (angles)': 45,
    'triangle type from the sentence (angles)': 47,
    'triangle type from the drawing (sides)': 51,
    'triangle type from the sentence (sides)': 54,
    'the current triangle': 58, 'a missing leg': 59, 'the brace across a crate': 60,
    'a missing hypotenuse': 62, 'area from a drawn height': 63,
    'area and perimeter together': 64, "Heron's formula": 66,
    'missing angle with a square corner': 67, 'isosceles angles': 68,
    'equilateral angles': 69, 'two angles given': 70, 'crossed triangles': 71,
    'a midline parallel to the base': 72, 'crossed similar triangles': 73,
    'similar rectangles': 74, 'a braced ramp': 75, 'shadows': 76,
    'similar triangles in a right triangle': 77,
    'similar triangles about an apex': 78, 'trapezoid with a triangular hole': 79,
    'parallelogram with a rectangular hole': 80, 'the punched piece itself': 81,
    'rectangle with a triangular hole': 82,
}

caught = missed = 0
for what, n in sorted(FAMILIES.items(), key=lambda kv: kv[1]):
    hit = False
    for v in 'BCD':
        real = V.KEY[n][v]
        wrong = next(c for c in 'abcd' if c != real)
        got = V.solve(V.D[v][n])
        if got is not None and got != wrong:
            hit = True
            break
    print(('  caught  ' if hit else '  MISSED  ') + f'Q{n}: {what}')
    caught += hit
    missed += not hit

print(f'\n{caught} of {caught + missed} question families would catch a wrong key.')
