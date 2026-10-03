# Blender (4.2.3) side of tools/lib/dragon-source.mjs: import a glTF, put every action that drives an
# armature on its own NLA track so all clips are exported, and write a GLB without Draco.
#   blender -b --factory-startup -P tools/lib/blender-reexport.py -- in.glb out.glb
import bpy, sys, re

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene
for arm in [o for o in scene.objects if o.type == "ARMATURE"]:
    bones = set(b.name for b in arm.data.bones)
    if not arm.animation_data:
        arm.animation_data_create()
    ad = arm.animation_data
    for t in list(ad.nla_tracks):
        ad.nla_tracks.remove(t)
    added = set()
    for a in bpy.data.actions:
        names = set(re.findall(r'pose\.bones\["([^"]+)"\]', " ".join(fc.data_path for fc in a.fcurves)))
        if not (names & bones) or a.name in added:
            continue
        track = ad.nla_tracks.new()
        track.name = a.name
        track.strips.new(a.name, int(a.frame_range[0]), a)
        added.add(a.name)
    ad.action = None
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_animation_mode="NLA_TRACKS", use_visible=False, export_apply=False)
