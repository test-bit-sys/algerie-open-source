"""
DZ-Photo Native — Layered Raster Graphic Design & Photo Studio Engine in Python
--------------------------------------------------------------------------------
Part of DZ Open Suite (المنظومة الجزائرية للبرمجيات المفتوحة المصدر).
High-performance native image processing using Pillow and NumPy.
Replaces Adobe Photoshop & PhotoCraft with local sovereign execution.
"""

import os
import sys
from typing import List, Tuple, Optional
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
import numpy as np

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


class Layer:
    """Represents a single raster layer in the document stack."""

    def __init__(self, name: str, image: Image.Image, opacity: float = 1.0, visible: bool = True):
        self.name = name
        self.image = image.convert("RGBA")
        self.opacity = max(0.0, min(1.0, opacity))
        self.visible = visible
        self.blend_mode = "normal"  # normal, multiply, screen, overlay

    @property
    def size(self) -> Tuple[int, int]:
        return self.image.size

    def set_opacity(self, opacity: float):
        self.opacity = max(0.0, min(1.0, opacity))


class CanvasDocument:
    """Multi-layer document container with rendering pipeline."""

    def __init__(self, width: int = 1920, height: int = 1080, background_color: Tuple[int, int, int, int] = (255, 255, 255, 255)):
        self.width = width
        self.height = height
        self.background_color = background_color
        self.layers: List[Layer] = []
        
        # Base background layer
        bg_img = Image.new("RGBA", (width, height), background_color)
        self.add_layer("Arrière-plan", bg_img)

    def add_layer(self, name: str, image: Image.Image, opacity: float = 1.0) -> Layer:
        if image.size != (self.width, self.height):
            # Fit or resize to canvas
            resized = image.resize((self.width, self.height), Image.Resampling.LANCZOS)
        else:
            resized = image
        layer = Layer(name, resized, opacity)
        self.layers.append(layer)
        return layer

    def render_composite(self) -> Image.Image:
        """Composites all visible layers from bottom to top respecting opacity."""
        composite = Image.new("RGBA", (self.width, self.height), (0, 0, 0, 0))

        for layer in self.layers:
            if not layer.visible or layer.opacity <= 0.0:
                continue

            # Apply layer opacity
            layer_img = layer.image.copy()
            if layer.opacity < 1.0:
                r, g, b, a = layer_img.split()
                a = a.point(lambda p: int(p * layer.opacity))
                layer_img.putalpha(a)

            # Composite over base
            composite = Image.alpha_composite(composite, layer_img)

        return composite

    # --- Algerian Signature Visual Filters ---

    @staticmethod
    def apply_sahara_sunset_filter(img: Image.Image) -> Image.Image:
        """Warm amber/golden tone matching the Algerian Sahara."""
        rgb = img.convert("RGB")
        arr = np.array(rgb, dtype=np.float32)

        # Warm up reds & yellows, soften blues
        arr[:, :, 0] = np.clip(arr[:, :, 0] * 1.15 + 15, 0, 255)  # R
        arr[:, :, 1] = np.clip(arr[:, :, 1] * 1.05 + 5, 0, 255)   # G
        arr[:, :, 2] = np.clip(arr[:, :, 2] * 0.85 - 10, 0, 255)  # B

        res = Image.fromarray(arr.astype(np.uint8))
        res = ImageEnhance.Contrast(res).enhance(1.1)
        res = ImageEnhance.Color(res).enhance(1.2)
        return res.convert(img.mode)

    @staticmethod
    def apply_mediterranean_blue_filter(img: Image.Image) -> Image.Image:
        """Crisp coastal azure tone matching the Algerian coastline."""
        rgb = img.convert("RGB")
        arr = np.array(rgb, dtype=np.float32)

        arr[:, :, 0] = np.clip(arr[:, :, 0] * 0.90, 0, 255)       # R
        arr[:, :, 1] = np.clip(arr[:, :, 1] * 1.08 + 10, 0, 255)  # G
        arr[:, :, 2] = np.clip(arr[:, :, 2] * 1.20 + 20, 0, 255)  # B

        res = Image.fromarray(arr.astype(np.uint8))
        res = ImageEnhance.Contrast(res).enhance(1.15)
        return res.convert(img.mode)

    @staticmethod
    def apply_casbah_sepia_filter(img: Image.Image) -> Image.Image:
        """Antique sepia tone matching historical Algiers Casbah photos."""
        gray = img.convert("L")
        sepia = ImageOps.colorize(gray, "#2e1c0c", "#ffebd4")
        return sepia.convert(img.mode)

    def export(self, filepath: str, quality: int = 95):
        comp = self.render_composite()
        ext = os.path.splitext(filepath)[1].lower()
        if ext in [".jpg", ".jpeg"]:
            comp.convert("RGB").save(filepath, "JPEG", quality=quality)
        elif ext == ".webp":
            comp.save(filepath, "WEBP", quality=quality)
        else:
            comp.save(filepath, "PNG")
        print(f"Exported DZ-Photo Canvas: {filepath} ({self.width}x{self.height}, {len(self.layers)} layers)")


if __name__ == "__main__":
    print("=" * 80)
    print("  DZ-Photo Native -- استوديو معالجة وتصميم الصور النقطية بلغة Python")
    print("  المنظومة الجزائرية للبرمجيات المفتوحة المصدر (DZ Open Suite)")
    print("=" * 80)

    # Création d'un canevas Full HD
    doc = CanvasDocument(1920, 1080, background_color=(20, 24, 33, 255))

    # Génération d'une couche de dégradé artistique
    gradient_arr = np.zeros((1080, 1920, 4), dtype=np.uint8)
    for y in range(1080):
        val = int(255 * (y / 1080.0))
        gradient_arr[y, :, 0] = int(val * 0.6)  # Red
        gradient_arr[y, :, 1] = int(val * 0.8)  # Green
        gradient_arr[y, :, 2] = val             # Blue
        gradient_arr[y, :, 3] = 180             # Alpha

    layer_grad = Image.fromarray(gradient_arr, "RGBA")
    doc.add_layer("Dégradé Artistique", layer_grad, opacity=0.85)

    # Test d'application des filtres algériens
    filtered_sunset = CanvasDocument.apply_sahara_sunset_filter(layer_grad)
    doc.add_layer("Filtre Coucher de Soleil Sahara", filtered_sunset, opacity=0.7)

    output_path = "output_dzphoto_demo.png"
    doc.export(output_path)
    
    if os.path.exists(output_path):
        size_kb = os.path.getsize(output_path) / 1024.0
        print(f"Generated Demo Image: {output_path} ({size_kb:.2f} KB)")
        os.remove(output_path)

    print("=" * 80)
    print("  Moteur DZ-Photo Native opérationnel avec succès (Pillow / NumPy).")
    print("=" * 80)
