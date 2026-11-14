"""Shared Blender helpers for convert.py and bake.py. Everything asset-specific comes from manifest.json."""
import hashlib
import json
import math
import os
import sys

import bpy
from mathutils import Vector

FPS = 30
FBX_AXES = {"axis_forward": "-Z", "axis_up": "Y"}
SAMPLES_PER_CLIP = 8
VIEWS = {"front": (0.6, 0.35, 0.75), "side": (1.0, 0.22, 0.05), "back": (-0.6, 0.35, -0.75)}


def script_args():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def load_manifest(out_dir):
    with open(os.path.join(out_dir, "manifest.json"), encoding="utf-8") as fh:
        return json.load(fh)


def write_manifest(out_dir, manifest):
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def reset(fps=FPS):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = fps
    scene.render.fps_base = 1.0
    scene.frame_start = 0


def armature():
    return next(o for o in bpy.data.objects if o.type == "ARMATURE")


def meshes():
    return [o for o in bpy.data.objects if o.type == "MESH"]


def drop_bone_shapes(arm):
    """The glTF importer adds icosphere bone shapes; they would be exported as extra meshes."""
    shapes = {b.custom_shape for b in arm.pose.bones if b.custom_shape}
    for b in arm.pose.bones:
        b.custom_shape = None
    for obj in shapes:
        bpy.data.objects.remove(obj, do_unlink=True)


def actions():
    return {act.name.split("|")[-1]: act for act in bpy.data.actions}


def frame_range(act):
    start, end = act.frame_range
    return int(round(start)), int(round(end))


def import_glb(path, fps=FPS):
    reset(fps)
    bpy.ops.import_scene.gltf(filepath=path)
    arm = armature()
    drop_bone_shapes(arm)
    acts = actions()
    bpy.context.scene.frame_end = max(frame_range(a)[1] for a in acts.values())
    for act in acts.values():
        act.use_fake_user = True
    return arm, acts


def import_fbx(path, fps=FPS):
    reset(fps)
    bpy.ops.import_scene.fbx(filepath=path, use_anim=True, automatic_bone_orientation=False, **FBX_AXES)
    arm = armature()
    drop_bone_shapes(arm)
    return arm, actions()


def assign(arm, act):
    arm.animation_data_create()
    ad = arm.animation_data
    for track in list(ad.nla_tracks):
        track.mute = True
    ad.action = act
    if hasattr(ad, "action_slot") and act.slots:
        ad.action_slot = act.slots[0]


def sample(arm, acts, bones):
    scene = bpy.context.scene
    result = {}
    for name, act in sorted(acts.items()):
        assign(arm, act)
        start, end = frame_range(act)
        rows = []
        for k in range(SAMPLES_PER_CLIP):
            f = start + (end - start) * k / (SAMPLES_PER_CLIP - 1)
            scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))
            rows.append({b: list(arm.matrix_world @ arm.pose.bones[b].head) for b in bones})
        result[name] = rows
    return result


def max_delta(a, b, bones, turned=False):
    """Largest bone-head distance; `turned` compares against `a` rotated 180 degrees about Blender Z."""
    worst = 0.0
    for clip in a:
        if clip not in b:
            return float("inf")
        for ra, rb in zip(a[clip], b[clip]):
            for bone in bones:
                x, y, z = ra[bone]
                expected = Vector((-x, -y, z)) if turned else Vector((x, y, z))
                worst = max(worst, (expected - Vector(rb[bone])).length)
    return worst


def turn_around(arm):
    """Rotate the rig 180 degrees about Blender Z and apply it, so Unity's FBX importer
    (which mirrors Z for handedness) ends up with the model facing Unity +Z."""
    body = [o for o in meshes() if o.parent == arm]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in [arm, *body]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = arm
    arm.rotation_mode = "XYZ"
    arm.rotation_euler.z += math.pi
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)


def describe(arm, acts):
    mesh_objs = meshes()
    return {
        "bones": len(arm.data.bones),
        "meshObjects": len(mesh_objs),
        "vertices": sum(len(o.data.vertices) for o in mesh_objs),
        "triangles": sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in mesh_objs),
        "materials": sorted({s.material.name for o in mesh_objs for s in o.material_slots if s.material}),
        "uvLayers": sorted({u.name for o in mesh_objs for u in o.data.uv_layers}),
        "colorAttributes": sorted({a.name for o in mesh_objs for a in o.data.color_attributes}),
        "actions": {n: frame_range(a) for n, a in sorted(acts.items())},
    }


def export_fbx(path):
    turn_around(armature())
    bpy.ops.export_scene.fbx(
        filepath=path,
        use_selection=False,
        object_types={"ARMATURE", "MESH"},
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_UNITS",
        **FBX_AXES,
        use_mesh_modifiers=True,
        mesh_smooth_type="FACE",
        use_tspace=True,
        colors_type="SRGB",
        add_leaf_bones=False,
        primary_bone_axis="Y",
        secondary_bone_axis="X",
        bake_anim=True,
        bake_anim_use_all_bones=True,
        bake_anim_use_nla_strips=False,
        bake_anim_use_all_actions=True,
        bake_anim_force_startend_keying=True,
        bake_anim_step=1.0,
        bake_anim_simplify_factor=0.0,
        path_mode="COPY",
        embed_textures=True,
    )


def sha256(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def gltf_to_blender(v):
    return Vector((v[0], -v[2], v[1]))


def render(arm, acts, manifest, out_dir, tag, turned=False):
    """Render manifest shots; the camera is framed from manifest bounds (glTF space)."""
    os.makedirs(out_dir, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 960, 540
    world = bpy.data.worlds.new("w")
    world.color = (0.06, 0.06, 0.07)
    scene.world = world
    for name, energy, color, rot in [
        ("key", 4.0, (1.0, 0.95, 0.88), (50, 0, 30)),
        ("rim", 2.5, (0.65, 0.75, 1.0), (60, 0, 200)),
    ]:
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, "SUN"))
        light.data.energy = energy
        light.data.color = color
        light.rotation_euler = tuple(math.radians(v) for v in rot)
        scene.collection.objects.link(light)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 40
    scene.collection.objects.link(cam)
    scene.camera = cam
    lo, hi = manifest["bounds"]["min"], manifest["bounds"]["max"]
    center = gltf_to_blender([(a + b) / 2 for a, b in zip(lo, hi)])
    extent = max(b - a for a, b in zip(lo, hi))
    flip = Vector((-1, -1, 1)) if turned else Vector((1, 1, 1))
    paths = []
    for shot in manifest["shots"]:
        clip, u, view = shot["clip"], shot["t"], shot.get("view", "front")
        if clip not in acts:
            continue
        act = acts[clip]
        assign(arm, act)
        start, end = frame_range(act)
        scene.frame_set(int(round(start + (end - start) * u)))
        offset = gltf_to_blender(VIEWS.get(view, VIEWS["front"])).normalized() * extent * 2.6
        target = center * flip
        cam.location = (center + offset) * flip
        cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
        path = os.path.join(out_dir, f"{tag}-{clip}-{u}-{view}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    return paths
