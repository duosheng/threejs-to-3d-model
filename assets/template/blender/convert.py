"""GLB -> FBX conversion and round-trip check, run inside Blender:

    blender -b --factory-startup -P blender/convert.py -- <glb> <out_dir>
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import common  # noqa: E402

glb_arg, out_arg = common.script_args()[:2]
GLB = os.path.abspath(glb_arg)
OUT = os.path.abspath(out_arg)
STEM = os.path.splitext(os.path.basename(GLB))[0]
FBX = os.path.join(OUT, f"{STEM}.fbx")
manifest = common.load_manifest(OUT)
bones = manifest["checkBones"]
fps = manifest["clips"][0]["fps"]

report = {"glb": GLB, "fbx": FBX, "blender": bpy.app.version_string, "fps": fps}

arm, acts = common.import_glb(GLB, fps)
report["glbImport"] = common.describe(arm, acts)
glb_samples = common.sample(arm, acts, bones)
common.export_fbx(FBX)

arm2, acts2 = common.import_fbx(FBX, fps)
report["fbxReimport"] = common.describe(arm2, acts2)
report["roundTripMaxBoneDeltaMeters"] = common.max_delta(glb_samples, common.sample(arm2, acts2, bones), bones, turned=True)
report["fbxBytes"] = os.path.getsize(FBX)
report["renders"] = common.render(arm2, acts2, manifest, os.path.join(OUT, "blender-renders"), "fbx", turned=True)

with open(os.path.join(OUT, "blender-report.json"), "w", encoding="utf-8") as fh:
    json.dump(report, fh, ensure_ascii=False, indent=2)

manifest["fbx"] = {
    "asset": os.path.basename(FBX),
    "sha256": common.sha256(FBX),
    "bytes": report["fbxBytes"],
    "generator": f"Blender {bpy.app.version_string} blender/convert.py",
    "format": "FBX 7.4 binary, textures embedded",
    "axes": "rig turned 180° about up before export; axis_forward=-Z axis_up=Y, 1 unit = 1 m; faces +Z in Unity",
    "fps": fps,
    "takes": sorted(acts2.keys()),
    "roundTripMaxBoneDeltaMeters": report["roundTripMaxBoneDeltaMeters"],
    "note": "颜色依赖顶点色，引擎标准材质不显示；引擎通用版本见 baked。Blender 回读 FBX 的偏差不作验收依据，以引擎实测为准。",
}
common.write_manifest(OUT, manifest)
print("REPORT_JSON " + json.dumps({k: v for k, v in report.items() if k != "renders"}, ensure_ascii=False))
