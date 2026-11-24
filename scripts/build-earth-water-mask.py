"""Reduce the existing ETOPO panorama to orbital coverage and a clearance bound."""
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

root = Path(__file__).resolve().parents[1] / "static/earth-background"
alpha = np.asarray(Image.open(root / "surface-relief.webp").getchannel("A"))
sea = alpha < 208
Image.fromarray(sea.astype("uint8") * 255).resize((1024, 512), Image.Resampling.BOX).save(
    root / "ocean-mask.webp", lossless=True, method=6
)
# Treat every mixed cell as land. The extra two diagonals also cover the
# nearest-neighbour sampling error in both the land and receiver cells.
height, width = 128, 256
land = ~sea.reshape(height, alpha.shape[0] // height, width, alpha.shape[1] // width).all(axis=(1, 3))
y, x = np.indices((height, width))
lat, lon = (0.5 - (y + 0.5) / height) * np.pi, ((x + 0.5) / width - 0.5) * 2 * np.pi
points = np.stack((np.cos(lat)*np.cos(lon), np.cos(lat)*np.sin(lon), np.sin(lat)), axis=-1)
distances, _ = cKDTree(points[land]).query(points)
clearance = np.maximum(0, 6378.137 * distances - 2 * 6378.137 * np.pi / height * np.sqrt(2))
np.floor(np.minimum(255, clearance / 4)).astype("uint8").tofile(root / "ocean-clearance.bin")
