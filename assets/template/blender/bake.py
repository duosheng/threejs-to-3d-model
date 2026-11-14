"""Bake vertex colour, tiled textures, normals and emission onto one non-overlapping UV set,
then export engine-neutral GLB + FBX. Run inside Blender:

    blender -b --factory-startup -P blender/bake.py -- <glb> <out_dir> [size]
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import common  # noqa: E402

args = common.script_args()
GLB = os.path.abspath(args[0])
OUT = os.path.abspath(args[1])
SIZE = int(args[2]) if len(args) > 2 else 2048
STEM = os.path.splitext(os.path.basename(GLB))[0]
TEX_DIR = os.path.join(OUT, "textures")
BAKED_GLB = os.path.join(OUT, f"{STEM}-baked.glb")
BAKED_FBX = os.path.join(OUT, f"{STEM}-baked.fbx")
SOURCE_UV = "UVMap"
BAKE_UV = "BakeUV"
KEPT = {"Roughness": "roughness", "Metallic": "metallic", "Emission Strength": "emissionStrength",
        "Coat Weight": "coatWeight", "Coat Roughness": "coatRoughness"}
os.makedirs(TEX_DIR, exist_ok=True)
manifest = common.load_manifest(OUT)
bones = manifest["checkBones"]
fps = manifest["clips"][0]["fps"]


def principled(mat):
    return next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def output(mat):
    return next(n for n in mat.node_tree.nodes if n.type == "OUTPUT_MATERIAL")


def pin_source_uvs(mat):
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    for node in list(nodes):
        if node.type == "TEX_IMAGE" and not node.inputs["Vector"].is_linked:
            uv = nodes.new("ShaderNodeUVMap")
            uv.uv_map = SOURCE_UV
            links.new(uv.outputs["UV"], node.inputs["Vector"])


def new_image(name, non_color):
    img = bpy.data.images.new(name, SIZE, SIZE, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    img.generated_color = (0.5, 0.5, 1.0, 1.0) if non_color else (0, 0, 0, 1)
    return img


def set_target(mat, img):
    nodes = mat.node_tree.nodes
    node = nodes.get("__bake_target") or nodes.new("ShaderNodeTexImage")
    node.name = "__bake_target"
    node.image = img
    for n in nodes:
        n.select = False
    node.select = True
    nodes.active = node


def bake_channel(mats, img, socket_name, zero_when=None):
    """Bake one Principled input as unlit emission so values land in the texture unchanged.

    zero_when names a scalar input; materials where it is 0 bake black, because FBX
    importers drop that scalar and would otherwise show the raw input (e.g. the
    white default Emission Color of non-emissive materials)."""
    saved = []
    for mat in mats:
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        bsdf, out = principled(mat), output(mat)
        src = bsdf.inputs[socket_name]
        emit = nodes.new("ShaderNodeEmission")
        emit.inputs["Strength"].default_value = 1.0
        if zero_when and bsdf.inputs[zero_when].default_value == 0:
            emit.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
        elif src.is_linked:
            links.new(src.links[0].from_socket, emit.inputs["Color"])
        else:
            value = src.default_value
            emit.inputs["Color"].default_value = (value[0], value[1], value[2], 1.0)
        saved.append((mat, out.inputs["Surface"].links[0].from_socket, emit))
        links.new(emit.outputs["Emission"], out.inputs["Surface"])
        set_target(mat, img)
    bpy.ops.object.bake(type="EMIT", margin=8, margin_type="EXTEND", use_clear=True)
    for mat, surface, emit in saved:
        mat.node_tree.links.new(surface, output(mat).inputs["Surface"])
        mat.node_tree.nodes.remove(emit)


def bake_normal(mats, img):
    for mat in mats:
        set_target(mat, img)
    bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", margin=8, margin_type="EXTEND", use_clear=True)


def rebuild(mat, images, params):
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    uv = nodes.new("ShaderNodeUVMap")
    uv.uv_map = SOURCE_UV

    def tex(img):
        node = nodes.new("ShaderNodeTexImage")
        node.image = img
        links.new(uv.outputs["UV"], node.inputs["Vector"])
        return node

    links.new(tex(images["basecolor"]).outputs["Color"], bsdf.inputs["Base Color"])
    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.uv_map = SOURCE_UV
    links.new(tex(images["normal"]).outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(tex(images["emissive"]).outputs["Color"], bsdf.inputs["Emission Color"])
    for name, value in params.items():
        bsdf.inputs[name].default_value = value


report = {"glb": GLB, "blender": bpy.app.version_string, "textureSize": SIZE}

arm, acts = common.import_glb(GLB, fps)
reference = common.sample(arm, acts, bones)

arm, acts = common.import_glb(GLB, fps)
body = next(o for o in common.meshes() if o.parent == arm)
arm.data.pose_position = "REST"
mats = [slot.material for slot in body.material_slots]
kept = {mat.name: {name: principled(mat).inputs[name].default_value for name in KEPT} for mat in mats}

me = body.data
me.uv_layers[SOURCE_UV].active_render = True
bake_uv = me.uv_layers.new(name=BAKE_UV)
me.uv_layers.active = bake_uv
for obj in bpy.data.objects:
    obj.select_set(False)
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.002, area_weight=0.0, scale_to_bounds=True)
bpy.ops.uv.pack_islands(rotate=True, margin=0.002)
bpy.ops.object.mode_set(mode="OBJECT")

for mat in mats:
    pin_source_uvs(mat)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 4
scene.render.bake.use_selected_to_active = False

images = {
    "basecolor": new_image(f"{STEM}_basecolor", False),
    "emissive": new_image(f"{STEM}_emissive", False),
    "normal": new_image(f"{STEM}_normal", True),
}
bake_channel(mats, images["basecolor"], "Base Color")
bake_channel(mats, images["emissive"], "Emission Color", zero_when="Emission Strength")
bake_normal(mats, images["normal"])
for name, img in images.items():
    path = os.path.join(TEX_DIR, f"{img.name}.png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    img.filepath = path

for mat in mats:
    rebuild(mat, images, kept[mat.name])
me.uv_layers.remove(me.uv_layers[SOURCE_UV])
me.uv_layers[BAKE_UV].name = SOURCE_UV
me.uv_layers[SOURCE_UV].active = True
me.uv_layers[SOURCE_UV].active_render = True
for attr in list(me.color_attributes):
    me.color_attributes.remove(attr)
arm.data.pose_position = "POSE"

gltf_kwargs = dict(
    filepath=BAKED_GLB,
    export_format="GLB",
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_force_sampling=True,
    export_skins=True,
    export_yup=True,
    export_tangents=True,
    export_image_format="AUTO",
)
try:
    bpy.ops.export_scene.gltf(**gltf_kwargs, export_vertex_color="NONE")
except TypeError:
    bpy.ops.export_scene.gltf(**gltf_kwargs)
common.export_fbx(BAKED_FBX)
report["textures"] = {
    name: {"file": f"textures/{img.name}.png", "sha256": common.sha256(img.filepath_raw)} for name, img in images.items()
}

renders = []
checks = {}
for label, path, loader in [("fbx", BAKED_FBX, common.import_fbx), ("glb", BAKED_GLB, common.import_glb)]:
    turned = label == "fbx"
    arm2, acts2 = loader(path, fps)
    checks[label] = common.describe(arm2, acts2)
    checks[label]["roundTripMaxBoneDeltaMeters"] = common.max_delta(reference, common.sample(arm2, acts2, bones), bones, turned=turned)
    checks[label]["bytes"] = os.path.getsize(path)
    checks[label]["sha256"] = common.sha256(path)
    if turned:
        renders = common.render(arm2, acts2, manifest, os.path.join(OUT, "blender-renders"), "baked-fbx", turned=True)
report["checks"] = checks
report["materials"] = [
    {"name": name, **{KEPT[k]: (list(v) if hasattr(v, "__len__") else v) for k, v in params.items()}}
    for name, params in kept.items()
]

with open(os.path.join(OUT, "blender-bake-report.json"), "w", encoding="utf-8") as fh:
    json.dump({**report, "renders": renders}, fh, ensure_ascii=False, indent=2)

manifest = common.load_manifest(OUT)
manifest["baked"] = {
    "generator": f"Blender {bpy.app.version_string} blender/bake.py",
    "glb": {"asset": os.path.basename(BAKED_GLB), **{k: checks["glb"][k] for k in ("sha256", "bytes", "roundTripMaxBoneDeltaMeters")}},
    "fbx": {"asset": os.path.basename(BAKED_FBX), **{k: checks["fbx"][k] for k in ("sha256", "bytes", "roundTripMaxBoneDeltaMeters")}},
    "textures": report["textures"],
    "textureSize": SIZE,
    "materials": report["materials"],
    "note": "单套不重叠 UV；顶点色与平铺纹理已烘进 basecolor，无顶点色。FBX 不带粗糙度/自发光强度，引擎端按 materials 补设。",
}
common.write_manifest(OUT, manifest)
print("REPORT_JSON " + json.dumps(report, ensure_ascii=False))
