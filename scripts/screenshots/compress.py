"""Stores every PNG in a folder with a 256-colour palette. Usage: compress.py <folder>"""
import pathlib
import sys

from PIL import Image

for path in sorted(pathlib.Path(sys.argv[1]).glob("*.png")):
    image = Image.open(path)
    if image.mode == "P":
        continue  # already done
    small = image.convert("RGBA").quantize(
        colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG
    )
    small.save(path, optimize=True)
