COLOR_PATHS = [
    ("Textures\\Black32", "黑色", "黑色轮廓"),
    ("Textures\\white", "白色", "白色轮廓"),
    ("ReplaceableTextures\TeamColor\TeamColor00", "红色", "红色轮廓"),
    ("ReplaceableTextures\TeamColor\TeamColor01", "蓝色", "蓝色轮廓"),
    ("ReplaceableTextures\TeamColor\TeamColor02", "青色", "青色轮廓"),
    ("ReplaceableTextures\TeamColor\TeamColor03", "紫色", "紫色轮廓"),
    ("ReplaceableTextures\TeamColor\TeamColor04", "黄色", "黄色轮廓"),
    ("ReplaceableTextures\TeamColor\TeamColor05", "橙色", "橙色轮廓"),
    ("ReplaceableTextures\TeamColor\TeamColor06", "绿色", "绿色轮廓"),
    ("ReplaceableTextures\TeamColor\TeamColor07", "粉色", "粉色轮廓"),
    ("ReplaceableTextures\TeamColor\TeamColor08", "灰色", "灰色轮廓"),
    ("ReplaceableTextures\TeamColor\TeamColor09", "淡蓝色", "淡蓝色轮廓"),
    ("ReplaceableTextures\TeamColor\TeamColor10", "深绿色", "深绿色轮廓"),
]
import bpy
import re
import math
import os
import mdl_layer_utils
import platform
import keyframe_utils
import animation_smoother
import getpass
import uuid
import subprocess
import hashlib
import bmesh
import bpy_extras
import json
import urllib.request
import urllib.error
import ssl
import tempfile
import zipfile
import shutil
import time
import concurrent.futures
import functools
from mathutils import Vector, Matrix
from datetime import datetime
from pathlib import Path
from bpy.types import Operator, Panel, UIList
from bpy.props import StringProperty, BoolProperty, EnumProperty, IntProperty, FloatProperty
from bpy.props import EnumProperty, FloatProperty, BoolProperty, CollectionProperty
license_valid = False
license_expiry = None
license_checked = False
IS_BLENDER_4_PLUS = bpy.app.version >= (4, 0, 0)
class BoneAlignSettings(bpy.types.PropertyGroup):
    start_frame: bpy.props.IntProperty(name="开始帧", default=1, min=0)
    end_frame: bpy.props.IntProperty(name="结束帧", default=10, min=0)
class BoneAlignProperties(bpy.types.PropertyGroup):
    start_frame: bpy.props.IntProperty(name="开始帧", default=10, min=1)
    end_frame: bpy.props.IntProperty(name="结束帧", default=40, min=1)
def load_action_mapping():
    mapping_rules = {}
    script_dir = os.path.dirname(os.path.realpath(__file__))
    mapping_file = os.path.join(script_dir, "action_name_mapping.txt")
    if not os.path.exists(mapping_file):
        return mapping_rules
    try:
        with open(mapping_file, 'r', encoding='utf-8') as f:
            current_group = None
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if line.startswith('[') and line.endswith(']'):
                    current_group = line[1:-1]
                    mapping_rules[current_group] = {}
                elif current_group and '->' in line:
                    parts = line.split('->', 1)
                    if len(parts) == 2:
                        pattern = parts[0].strip()
                        replacement = parts[1].strip()
                        mapping_rules[current_group][pattern] = replacement
        return mapping_rules
    except Exception:
        return {}
def delete_empty_objects(context):
    empty_objects = [obj for obj in context.scene.objects if obj.type == 'EMPTY']
    count = len(empty_objects)
    for obj in empty_objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    return count
def collect_used_textures(context):
    used_textures = set()
    for obj in context.scene.objects:
        if obj.type != 'MESH':
            continue
        for slot in obj.material_slots:
            material = slot.material
            if not material or not material.use_nodes:
                continue
            for node in material.node_tree.nodes:
                if node.type == 'TEX_IMAGE' and node.image:
                    image = node.image
                    if image.filepath:
                        texture_file = os.path.basename(image.filepath)
                        if texture_file.lower().endswith(('.png', '.tga')):
                            used_textures.add(texture_file)
    return list(used_textures)
def get_machine_fingerprint():
    """
    获取 Windows 机器特征码 (仅限 Windows，使用主板UUID)
    """
    import subprocess
    import hashlib
    import platform
    import getpass
    
    machine_uuid = None
    try:
        cmd = "wmic csproduct get uuid"
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        output = subprocess.check_output(cmd, startupinfo=startupinfo, shell=True).decode().strip()
        lines = output.split('\n')
        for line in lines:
            if "UUID" not in line and line.strip():
                machine_uuid = line.strip()
                break
    except Exception:
        machine_uuid = None
    try:
        if machine_uuid:
            raw_data = f"WIN_UUID:{machine_uuid}"
        else:
            raw_data = f"Fallback:{platform.node()}_{getpass.getuser()}_Windows"
            
        return hashlib.md5(raw_data.encode()).hexdigest()
    except Exception:
        return "error_machine_id"
    
def copy_to_clipboard(text):
    try:
        try:
            import pyperclip
            pyperclip.copy(text)
            return True
        except ImportError: pass
        if platform.system() == "Windows":
            subprocess.run(['clip'], input=text.strip().encode('utf-8'), check=True)
            return True
        elif platform.system() == "Darwin":
            subprocess.run(['pbcopy'], input=text.strip().encode('utf-8'), check=True)
            return True
        else:
            try:
                subprocess.run(['xclip', '-selection', 'clipboard'], input=text.strip().encode('utf-8'), check=True)
                return True
            except:
                try:
                    subprocess.run(['xsel', '--clipboard', '--input'], input=text.strip().encode('utf-8'), check=True)
                    return True
                except: return False
    except Exception:
        return False
        
class LICENSE_OT_copy_machine_code(bpy.types.Operator):
    bl_idname = "license.copy_machine_code"
    bl_label = "复制机器码"
    def execute(self, context):
        machine_code = get_machine_fingerprint()
        if copy_to_clipboard(machine_code):
            self.report({'INFO'}, f"机器码已复制到剪贴板，请联系作者QQ2530075955")
        else:
            self.report({'ERROR'}, "复制失败，请手动记录机器码")
        return {'FINISHED'}
def validate_license_embedded():
    global license_valid, license_expiry, license_checked
    if license_checked and license_valid:
        return True, "许可证已验证", license_expiry
    try:
        machine_fp = get_machine_fingerprint()
        addon_dir = Path(__file__).resolve().parent
        parent_dir = addon_dir.parent  
        license_path = parent_dir / "license.lic"  
        if not os.path.exists(license_path):
            license_checked = True
            license_valid = False
            return False, "未找到许可证文件。请联系作者获取许可证。", None
        with open(license_path, 'r') as f:
            lines = f.readlines()
            if len(lines) < 2:
                license_checked = True
                license_valid = False
                return False, "许可证文件格式错误。", None
            expiry_date = lines[0].strip()
            license_key = lines[1].strip()
        secret_salt = "MY_SECRET_SALT_123"
        raw_data = machine_fp + secret_salt + expiry_date
        correct_license = hashlib.sha256(raw_data.encode('utf-8')).hexdigest()
        try:
            expiry_dt = datetime.strptime(expiry_date, "%Y-%m-%d")
            if datetime.now() > expiry_dt:
                license_checked = True
                license_valid = False
                return False, "许可证已过期。请联系作者续订。", expiry_date
        except ValueError:
            license_checked = True
            license_valid = False
            return False, "许可证文件中的日期格式错误。", None
        if license_key == correct_license:
            license_checked = True
            license_valid = True
            license_expiry = expiry_date
            return True, f"许可证验证成功! 有效期至: {expiry_date}", expiry_date
        else:
            license_checked = True
            license_valid = False
            return False, "许可证无效或与当前设备不匹配。", None
    except Exception as e:
        license_checked = True
        license_valid = False
        return False, f"许可证验证过程中出错: {str(e)}", None
def requires_license(func):
    @functools.wraps(func)
    def wrapper(self, context):
        valid, message, expiry_date = validate_license_embedded()
        if not valid:
            self.report({'ERROR'}, "需要有效的许可证才能使用此功能")
            return {'CANCELLED'}
        return func(self, context)
    return wrapper
class UpdateConfig:
    CURRENT_VERSION = (2, 4, 1)#更新版本
    GITEE_API_URL = "https://gitee.com/api/v5/repos/AMISD666/BlenderAnimMDL/releases/latest"
    @classmethod
    def get_current_version(cls):
        return cls.CURRENT_VERSION
    @classmethod 
    def get_version_string(cls):
        return ".".join(map(str, cls.CURRENT_VERSION))
class VersionChecker:
    def __init__(self):
        self.config = UpdateConfig()
    def get_remote_version_info(self):
        """
        从Gitee获取更新信息
        """
        try:
            req = urllib.request.Request(
                self.config.GITEE_API_URL,
                headers={'User-Agent': 'Blender-Addon-Updater'}
            )
            context = ssl._create_unverified_context()
            with urllib.request.urlopen(req, timeout=10, context=context) as response:
                if response.status == 200:
                    data = json.loads(response.read().decode('utf-8'))
                    return self.parse_gitee_response(data)
                else:
                    return None
        except Exception as e:
            print(f"Gitee更新检查失败: {str(e)}")
            return None
    def parse_gitee_response(self, data):
        """解析Gitee API响应"""
        version_str = data['tag_name'].lstrip('v')
        try:
            version_parts = version_str.split('.')
            version_tuple = tuple(int(part) for part in version_parts)
        except Exception:
            version_tuple = (0, 0, 0)
        download_url = None
        assets = data.get('assets', [])
        for asset in assets:
            name = asset.get('name', '')
            if name.lower().endswith('.zip'):
                download_url = asset.get('browser_download_url', '')
                if download_url:
                    break
        if not download_url:
            download_url = data.get('zipball_url', '')
        return {
            'version': version_tuple,
            'download_url': download_url,
            'changelog': data.get('body', ''),
            'release_notes': f"Gitee Release: {data.get('name', 'Unknown')}",
            'published_at': data.get('created_at', '')
        }
    def is_update_available(self):
        remote_info = self.get_remote_version_info()
        if not remote_info:
            return False, None, None
        current_version = self.config.get_current_version()
        remote_version = remote_info['version']
        if remote_version > current_version:
            return True, remote_version, remote_info['download_url']
        return False, None, None
    def get_update_details(self):
        return self.get_remote_version_info()
class AddonUpdater:
    def __init__(self):
        self.temp_dir = None
    def download_update(self, download_url):
        try:
            self.temp_dir = tempfile.mkdtemp()
            zip_path = os.path.join(self.temp_dir, "update.zip")
            req = urllib.request.Request(
                download_url,
                headers={'User-Agent': 'Blender-Addon-Updater'}
            )
            context = ssl._create_unverified_context()
            with urllib.request.urlopen(req, timeout=30, context=context) as response:
                with open(zip_path, 'wb') as f:
                    f.write(response.read())
            return zip_path
        except Exception as e:
            self.cleanup()
            raise Exception(f"下载失败: {str(e)}")
    def backup_current_version(self):
        try:
            addon_dir = os.path.dirname(os.path.realpath(__file__))
            backup_dir = os.path.join(tempfile.gettempdir(), f"blender_anim_tool_backup")
            if os.path.exists(backup_dir):
                shutil.rmtree(backup_dir)
            shutil.copytree(addon_dir, backup_dir)
            return backup_dir
        except Exception as e:
            raise Exception(f"备份失败: {str(e)}")
    def install_update(self, zip_path):
        try:
            addon_dir = os.path.dirname(os.path.realpath(__file__))
            backup_path = self.backup_current_version()
            extract_temp = tempfile.mkdtemp()
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(extract_temp)
            source_dir = self.find_plugin_directory(extract_temp)
            if not source_dir:
                raise Exception("在更新包中找不到插件文件")
            for root, dirs, files in os.walk(source_dir):
                for file in files:
                    if file.startswith('.') or file in ['README.md', '.gitignore', '.git']:
                        continue
                    source_file = os.path.join(root, file)
                    relative_path = os.path.relpath(source_file, source_dir)
                    target_file = os.path.join(addon_dir, relative_path)
                    os.makedirs(os.path.dirname(target_file), exist_ok=True)
                    shutil.copy2(source_file, target_file)
            shutil.rmtree(extract_temp)
            return True, backup_path
        except Exception as e:
            try:
                if 'backup_path' in locals() and os.path.exists(backup_path):
                    self.restore_backup(backup_path, addon_dir)
            except Exception: pass
            raise Exception(f"安装失败: {str(e)}")
    def find_plugin_directory(self, extract_dir):
        if os.path.exists(os.path.join(extract_dir, '__init__.py')):
            return extract_dir
        for item in os.listdir(extract_dir):
            item_path = os.path.join(extract_dir, item)
            if os.path.isdir(item_path):
                if os.path.exists(os.path.join(item_path, '__init__.py')):
                    return item_path
                sub_dir = self.find_plugin_directory(item_path)
                if sub_dir:
                    return sub_dir
        return None
    def restore_backup(self, backup_path, target_dir):
        for item in os.listdir(target_dir):
            if item in ['__pycache__']:
                continue
            item_path = os.path.join(target_dir, item)
            if os.path.isfile(item_path):
                os.remove(item_path)
            elif os.path.isdir(item_path):
                shutil.rmtree(item_path)
        for item in os.listdir(backup_path):
            if item == '__pycache__':
                continue
            source_item = os.path.join(backup_path, item)
            target_item = os.path.join(target_dir, item)
            if os.path.isfile(source_item):
                shutil.copy2(source_item, target_item)
            elif os.path.isdir(source_item):
                shutil.copytree(source_item, target_item)
    def cleanup(self):
        if self.temp_dir and os.path.exists(self.temp_dir):
            try:
                shutil.rmtree(self.temp_dir)
                self.temp_dir = None
            except: pass
class UPDATE_OT_check_for_updates(bpy.types.Operator):
    bl_idname = "addon.check_for_updates"
    bl_label = "检查更新"
    @requires_license
    def execute(self, context):
        import datetime
        checker = VersionChecker()
        update_available, new_version, download_url = checker.is_update_available()
        current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        context.window_manager.addon_last_update_check_time = current_time
        if update_available:
            current_version = UpdateConfig.get_current_version()
            context.window_manager.addon_update_available = True
            context.window_manager.addon_update_download_url = download_url
            context.window_manager.addon_new_version = ".".join(map(str, new_version))
            context.window_manager.addon_current_version = ".".join(map(str, current_version))
            details = checker.get_update_details()
            if details:
                context.window_manager.addon_update_changelog = details.get('changelog', '')
            self.report({'INFO'}, f"发现新版本: {context.window_manager.addon_new_version}")
        else:
            context.window_manager.addon_update_available = False
            if hasattr(context.window_manager, 'addon_update_changelog'):
                context.window_manager.addon_update_changelog = ""
            self.report({'INFO'}, "已是最新版本")
        return {'FINISHED'}
class UPDATE_OT_show_update_dialog(bpy.types.Operator):
    bl_idname = "addon.show_update_dialog"
    bl_label = "发现新版本"
    def invoke(self, context, event):
        return context.window_manager.invoke_props_dialog(self, width=400)
    def draw(self, context):
        layout = self.layout
        wm = context.window_manager
        layout.label(text=f"当前版本: {wm.addon_current_version} → 新版本: {wm.addon_new_version}")
        layout.label(text="是否立即更新？")
        checker = VersionChecker()
        details = checker.get_update_details()
        if details and details.get('changelog'):
            box = layout.box()
            box.label(text="更新内容:")
            for line in details['changelog'].split('\n'):
                if line.strip():
                    box.label(text=f"• {line.strip()}")
    def execute(self, context):
        return bpy.ops.addon.perform_update('EXEC_DEFAULT')
    def cancel(self, context):
        context.window_manager.addon_update_available = False
        return {'CANCELLED'}
class UPDATE_OT_perform_update(bpy.types.Operator):
    bl_idname = "addon.perform_update"
    bl_label = "更新插件"
    def execute(self, context):
        wm = context.window_manager
        download_url = wm.addon_update_download_url
        updater = AddonUpdater()
        try:
            self.report({'INFO'}, "开始下载更新...")
            zip_path = updater.download_update(download_url)
            self.report({'INFO'}, "安装更新...")
            success, backup_path = updater.install_update(zip_path)
            if success:
                self.report({'INFO'}, "更新成功！请重启Blender完成更新")
                wm.addon_update_available = False
                updater.cleanup()
                return bpy.ops.addon.show_restart_dialog('INVOKE_DEFAULT')
            else:
                self.report({'ERROR'}, "更新失败")
        except Exception as e:
            self.report({'ERROR'}, f"更新失败: {str(e)}")
            updater.cleanup()
        return {'FINISHED'}
class UPDATE_OT_show_restart_dialog(bpy.types.Operator):
    bl_idname = "addon.show_restart_dialog"
    bl_label = "更新完成"
    def invoke(self, context, event):
        return context.window_manager.invoke_props_dialog(self)
    def draw(self, context):
        layout = self.layout
        layout.label(text="插件已成功更新!")
        layout.label(text="请重启Blender以应用更改")
    def execute(self, context):
        return {'FINISHED'}
class VIEW3D_OT_import_fbx(bpy.types.Operator):
    bl_idname = "view3d.import_fbx"
    bl_label = "导入FBX"
    filepath: bpy.props.StringProperty(name="文件路径", maxlen=1024, default="", subtype='FILE_PATH')
    filter_glob: bpy.props.StringProperty(default="*.fbx", options={'HIDDEN'})
    my_scale: bpy.props.FloatProperty(name="缩放比例", min=0.001, max=1000.0, default=1.0)
    @requires_license
    def execute(self, context):
        try:
            bpy.ops.better_import.fbx(
                filepath=self.filepath,
                my_scale=self.my_scale,
                use_auto_bone_orientation=False,
                my_calculate_roll='None',
                my_bone_length=1.0,
                my_leaf_bone='Short',
                use_fix_bone_poses=False,
                use_fix_attributes=True,
                use_only_deform_bones=False,
                primary_bone_axis='Y',
                secondary_bone_axis='X',
                use_vertex_animation=True,
                use_animation=True,
                use_attach_to_selected_armature=False,
                my_animation_offset=0,
                use_animation_prefix=False,
                use_pivot=False,
                use_triangulate=False,
                my_import_normal='Import',
                use_auto_smooth=True,
                my_angle=30.0,
                my_shade_mode='Smooth',
                use_optimize_for_blender=False,
                use_reset_mesh_origin=True,
                use_reset_mesh_rotation=True,
                use_edge_crease=True,
                my_edge_crease_scale=1.0,
                my_edge_smoothing='FBXSDK',
                use_detect_deform_bone=True,
                use_import_materials=True,
                use_rename_by_filename=False,
                use_fix_mesh_scaling=False,
                my_rotation_mode='XYZ',
                my_fbx_unit='cm'
            )
            context.scene.last_imported_fbx_path = self.filepath
            bpy.ops.action.refresh_actions()       
            self.report({'INFO'}, f"FBX导入成功: {os.path.basename(self.filepath)}")
        except Exception as e:
            self.report({'ERROR'}, f"FBX导入失败: {str(e)}")
            return {'CANCELLED'}
        return {'FINISHED'}
    def invoke(self, context, event):
        context.window_manager.fileselect_add(self)
        return {'RUNNING_MODAL'}
class VIEW3D_OT_batch_import_fbx(bpy.types.Operator):
    bl_idname = "view3d.batch_import_fbx"
    bl_label = "多FBX合并"
    files: bpy.props.CollectionProperty(type=bpy.types.OperatorFileListElement, options={'HIDDEN', 'SKIP_SAVE'})
    directory: bpy.props.StringProperty(name="目录路径", maxlen=1024, default="", subtype='DIR_PATH')
    filter_glob: bpy.props.StringProperty(default="*.fbx", options={'HIDDEN'})
    @requires_license
    def execute(self, context):
        if not self.directory or not self.files:
            self.report({'ERROR'}, "未选择文件")
            return {'CANCELLED'}
        fbx_files = []
        for file_elem in self.files:
            if file_elem.name.lower().endswith('.fbx'):
                fbx_files.append(os.path.join(self.directory, file_elem.name))
        if not fbx_files:
            self.report({'ERROR'}, "没有选择有效的FBX文件")
            return {'CANCELLED'}
        original_objects = set(bpy.data.objects)
        imported_objects = []
        for i, fbx_file in enumerate(fbx_files):
            try:
                objects_before = set(bpy.data.objects)
                bpy.ops.better_import.fbx(
                    filepath=fbx_file,
                    my_scale=context.scene.simple_fbx_my_scale,
                    use_auto_bone_orientation=True,
                    my_calculate_roll='None',
                    my_bone_length=1.0,
                    my_leaf_bone='Short',
                    use_fix_bone_poses=False,
                    use_fix_attributes=True,
                    use_only_deform_bones=False,
                    primary_bone_axis='Y',
                    secondary_bone_axis='X',
                    use_vertex_animation=True,
                    use_animation=True,
                    use_attach_to_selected_armature=False,
                    my_animation_offset=0,
                    use_animation_prefix=False,
                    use_pivot=False,
                    use_triangulate=False,
                    my_import_normal='Import',
                    use_auto_smooth=True,
                    my_angle=30.0,
                    my_shade_mode='Smooth',
                    use_optimize_for_blender=False,
                    use_reset_mesh_origin=True,
                    use_reset_mesh_rotation=True,
                    use_edge_crease=True,
                    my_edge_crease_scale=1.0,
                    my_edge_smoothing='FBXSDK',
                    use_detect_deform_bone=True,
                    use_import_materials=True,
                    use_rename_by_filename=False,
                    use_fix_mesh_scaling=False,
                    my_rotation_mode='XYZ',
                    my_fbx_unit='cm'
                )
                objects_after = set(bpy.data.objects)
                new_objects = objects_after - objects_before
                imported_objects.extend(list(new_objects))
                self.report({'INFO'}, f"导入成功: {os.path.basename(fbx_file)}")
                if i < len(fbx_files) - 1:
                    for obj in new_objects:
                        bpy.data.objects.remove(obj, do_unlink=True)
                    imported_objects = []  
            except Exception as e:
                self.report({'ERROR'}, f"导入失败 {os.path.basename(fbx_file)}: {str(e)}")
        if fbx_files:
            context.scene.last_imported_fbx_path = fbx_files[-1]
        bpy.ops.action.refresh_actions()  
        bpy.ops.animation.refresh_list()
        self.report({'INFO'}, f"批量导入完成，共处理 {len(fbx_files)} 个文件")
        return {'FINISHED'}
    def invoke(self, context, event):
        context.window_manager.fileselect_add(self)
        return {'RUNNING_MODAL'}
def convert_blp_textures(context, directory_path, max_workers=4):
    """Converts textures to BLP format using parallel processing."""
    try:
        addon_dir = os.path.dirname(os.path.realpath(__file__))
        converter_path = os.path.join(addon_dir, "image-converter.exe")
        if not os.path.exists(converter_path):
            return False, f"未找到图像转换器: {converter_path}"
        used_textures = collect_used_textures(context)
        if not used_textures:
            return False, "没有找到模型使用的PNG或TGA贴图"
        
        # Prepare conversion tasks
        tasks = []
        for texture_file in used_textures:
            source_path = os.path.join(directory_path, texture_file)
            if not os.path.exists(source_path):
                continue
            base_name = os.path.splitext(texture_file)[0]
            target_blp = base_name + ".blp"
            target_path = os.path.join(directory_path, target_blp)
            tasks.append((texture_file, source_path, target_path))
        
        if not tasks:
            return False, "没有找到有效的贴图文件进行转换"
        
        def convert_single(task_data):
            """Worker function for single texture conversion."""
            texture_file, source_path, target_path = task_data
            try:
                cmd = [converter_path, source_path, target_path]
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                result = subprocess.run(cmd, capture_output=True, cwd=addon_dir, startupinfo=startupinfo)
                return (texture_file, result.returncode == 0)
            except Exception:
                return (texture_file, False)
        
        # Execute conversions in parallel using ThreadPoolExecutor
        success_count = 0
        failed_textures = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            results = list(executor.map(convert_single, tasks))
        
        for texture_file, success in results:
            if success:
                success_count += 1
            else:
                failed_textures.append(texture_file)
        
        message = f"成功转换 {success_count} 个贴图 (并行处理)"
        if failed_textures:
            message += f"，失败 {len(failed_textures)} 个: {', '.join(failed_textures)}"
        return True, message
    except Exception as e:
        return False, f"执行BLP贴图转换时出错: {str(e)}"
class INTERNAL_OT_convert_blp_textures(bpy.types.Operator):
    bl_idname = "internal.convert_blp_textures"
    bl_label = "Internal BLP Converter"
    bl_options = {'INTERNAL'}
    directory: bpy.props.StringProperty()
    def execute(self, context):
        if not self.directory:
            self.report({'ERROR'}, "No directory specified.")
            return {'CANCELLED'}
        success, message = convert_blp_textures(context, self.directory)
        if success:
            self.report({'INFO'}, message)
        else:
            self.report({'WARNING'}, message)
        return {'FINISHED'}
class WAR3_OT_add_mdl_layer_to_all_materials(bpy.types.Operator):
    bl_idname = "war3.add_mdl_layer_to_all_materials"
    bl_label = "为所有材质添加MDL层"
    @requires_license
    def execute(self, context):
        all_materials = set()
        for obj in context.scene.objects:
            if hasattr(obj, 'material_slots'):
                for slot in obj.material_slots:
                    if slot.material:
                        all_materials.add(slot.material)
        if not all_materials:
            self.report({'WARNING'}, "场景中没有材质")
            return {'CANCELLED'}
        layers_added = 0
        materials_skipped = 0
        for mat in all_materials:
            if not hasattr(mat, 'mdl_layers'):
                self.register_material_properties(mat)
            if len(mat.mdl_layers) == 0:
                self.add_single_layer_to_material(mat, layers_added)
                layers_added += 1
            else:
                materials_skipped += 1
        for area in context.screen.areas:
            if area.type == 'PROPERTIES':
                area.tag_redraw()
        self.report({'INFO'}, f"为 {layers_added} 个材质添加了MDL层，跳过了 {materials_skipped} 个已有层的材质")
        return {'FINISHED'}
    def register_material_properties(self, material):
        if not hasattr(bpy.types.Material, 'mdl_layers'):
            bpy.types.Material.mdl_layers = bpy.props.CollectionProperty(type=mdl_layer_utils.MDLLayerProperties)
        if not hasattr(bpy.types.Material, 'mdl_layer_index'):
            bpy.types.Material.mdl_layer_index = bpy.props.IntProperty(default=0)
    def add_single_layer_to_material(self, material, index):
        if not hasattr(material, 'mdl_layers'):
            self.register_material_properties(material)
        item = material.mdl_layers.add()
        item.name = f"Layer {index+1}"
        item.texture_type = '0'
        item.filter_mode = 'None'
        item.alpha = 1.0
        item.unshaded = True
        item.two_sided = False
        item.no_depth_test = False
        item.no_depth_set = False
        texture_path = self.get_material_texture_path(material)
        item.path = texture_path
        material.mdl_layer_index = len(material.mdl_layers) - 1
    def get_blp_path_from_image(self, image):
        if image.filepath:
            filepath = image.filepath
            filename = os.path.basename(filepath)
            base_name = os.path.splitext(filename)[0]
            blp_name = base_name + ".blp"
            return f"{blp_name}"
        else:
            image_name = image.name
            base_name = os.path.splitext(image_name)[0]
            blp_name = base_name + ".blp"
            return f"{blp_name}"
    def get_texture_node_from_link(self, node_input):
        if not node_input or not node_input.is_linked:
            return None
        node = node_input.links[0].from_node
        if node.type == 'TEX_IMAGE' and node.image:
            return node
        if node.type in ('MIX_RGB', 'GAMMA', 'BRIGHTNESS_CONTRAST'):
             if len(node.inputs) > 0 and node.inputs[0].is_linked:
                 return self.get_texture_node_from_link(node.inputs[0])
             elif node.inputs.get("Color1") and node.inputs["Color1"].is_linked:
                 return self.get_texture_node_from_link(node.inputs["Color1"])
        return None
    def get_material_texture_path(self, material):
        default_path = "Textures\\white.blp"
        if not material.use_nodes or not material.node_tree:
            return default_path
        found_node = None
        bsdf_nodes = []
        for node in material.node_tree.nodes:
            if node.type.startswith('BSDF_'):
                bsdf_nodes.append(node)
        bsdf_nodes.sort(key=lambda n: n.type != 'BSDF_PRINCIPLED')
        for node in bsdf_nodes:
            base_color_input = node.inputs.get("Base Color")
            tex_node = self.get_texture_node_from_link(base_color_input)
            if tex_node:
                found_node = tex_node
                break
            if not found_node:
                color_input = node.inputs.get("Color")
                tex_node = self.get_texture_node_from_link(color_input)
                if tex_node:
                    found_node = tex_node
                    break
        if found_node:
            return self.get_blp_path_from_image(found_node.image)
        for node in bsdf_nodes:
            emission_input = node.inputs.get("Emission")
            tex_node = self.get_texture_node_from_link(emission_input)
            if tex_node:
                found_node = tex_node
                break
        if found_node:
            return self.get_blp_path_from_image(found_node.image)
        normal_texture_nodes = set()
        for node in material.node_tree.nodes:
            normal_input = node.inputs.get("Normal")
            if normal_input:
                tex_node = self.get_texture_node_from_link(normal_input)
                if tex_node:
                    normal_texture_nodes.add(tex_node)
            if node.type == 'NORMAL_MAP':
                color_input = node.inputs.get("Color")
                tex_node = self.get_texture_node_from_link(color_input)
                if tex_node:
                    normal_texture_nodes.add(tex_node)
        first_tex_node = None
        for node in material.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image:
                if not first_tex_node:
                    first_tex_node = node
                if node not in normal_texture_nodes:
                    found_node = node
                    break
        if found_node:
             return self.get_blp_path_from_image(found_node.image)
        if first_tex_node:
             return self.get_blp_path_from_image(first_tex_node.image)
        return default_path
class OH_OT_Remove_Operator(bpy.types.Operator):
    bl_idname = "object.oh_remove"
    bl_label = "移除轮廓"
    bl_options = {"REGISTER", "UNDO"}
    @classmethod
    def poll(cls, context):
        return context.selected_objects and context.object and context.object.mode != "EDIT"
    def execute(self, context):
        selected_objects = context.selected_objects
        if not selected_objects:
            self.report({'WARNING'}, "没有选中任何对象")
            return {'CANCELLED'}
        for obj in selected_objects:
            if obj.type not in ["MESH", "CURVE"]:
                continue
            context.view_layer.objects.active = obj
            for color_path, color_name, color_desc in COLOR_PATHS:
                mat_index = obj.data.materials.find(color_path)
                if mat_index != -1:
                    obj.data.materials.pop(index=mat_index)
            mod = obj.modifiers.get("OH_OUTLINE")
            if mod:
                obj.modifiers.remove(mod)
            vg = obj.vertex_groups.get("OH_Outline_VertexGroup")
            if vg:
                obj.vertex_groups.remove(vg)
        return {"FINISHED"}
class OH_OT_Add_Outline_Operator(bpy.types.Operator):
    bl_idname = "object.oh_add_outline"
    bl_label = "添加轮廓"
    bl_options = {"REGISTER", "UNDO"}
    @classmethod
    def poll(cls, context):
        return context.selected_objects and context.object and context.object.mode != "EDIT"
    def get_color_from_path(self, color_path):
        color_mapping = {
            "Textures\\Black32": (0, 0, 0, 1),           
            "Textures\\white": (1, 1, 1, 1),             
            "ReplaceableTextures\TeamColor\TeamColor00": (1, 0, 0, 1),       
            "ReplaceableTextures\TeamColor\TeamColor01": (0, 0, 1, 1),       
            "ReplaceableTextures\TeamColor\TeamColor02": (0, 1, 1, 1),       
            "ReplaceableTextures\TeamColor\TeamColor03": (0.5, 0, 0.5, 1),   
            "ReplaceableTextures\TeamColor\TeamColor04": (1, 1, 0, 1),       
            "ReplaceableTextures\TeamColor\TeamColor05": (1, 0.5, 0, 1),     
            "ReplaceableTextures\TeamColor\TeamColor06": (0, 1, 0, 1),       
            "ReplaceableTextures\TeamColor\TeamColor07": (1, 0.5, 0.5, 1),   
            "ReplaceableTextures\TeamColor\TeamColor08": (0.5, 0.5, 0.5, 1), 
            "ReplaceableTextures\TeamColor\TeamColor09": (0.5, 0.5, 1, 1),   
            "ReplaceableTextures\TeamColor\TeamColor10": (0, 0.5, 0, 1),     
        }
        return color_mapping.get(color_path, (0, 0, 0, 1))
    def execute(self, context):
        selected_objects = context.selected_objects
        scene = context.scene
        if not selected_objects:
            self.report({'WARNING'}, "没有选中任何对象")
            return {'CANCELLED'}
        selected_color_path = scene.oh_outline_color
        color_value = self.get_color_from_path(selected_color_path)
        for obj in selected_objects:
            if obj.type not in ["MESH", "CURVE"]:
                continue
            context.view_layer.objects.active = obj
            if scene.oh_apply_scale:
                bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            mat_name = scene.oh_outline_color
            mat = bpy.data.materials.get(mat_name)
            if mat is None:
                mat = bpy.data.materials.new(name=mat_name)
                mat.use_nodes = True
                mat.use_backface_culling = True
                mat.shadow_method = "NONE"
                nodes = mat.node_tree.nodes
                nodes.clear()
                links = mat.node_tree.links
                node_color = nodes.new(type="ShaderNodeRGB")
                node_color.outputs[0].default_value = color_value
                node_color.location = (-700, -100)
                node_output = nodes.new(type="ShaderNodeOutputMaterial")
                node_output.location = (100, -100)
                node_output.target = "EEVEE"
                links.new(node_color.outputs[0], node_output.inputs[0])
                node_geometry = nodes.new(type="ShaderNodeNewGeometry")
                node_geometry.location = (-700, 400)
                node_transparency = nodes.new(type="ShaderNodeBsdfTransparent")
                node_transparency.location = (-700, 100)
                node_lightpath = nodes.new(type="ShaderNodeLightPath")
                node_lightpath.location = (-500, 500)
                node_mix_1 = nodes.new(type="ShaderNodeMixShader")
                node_mix_1.location = (-500, 100)
                node_mix_2 = nodes.new(type="ShaderNodeMixShader")
                node_mix_2.location = (-300, 100)
                node_mix_3 = nodes.new(type="ShaderNodeMixShader")
                node_mix_3.location = (-100, 100)
                node_output_cycles = nodes.new(type="ShaderNodeOutputMaterial")
                node_output_cycles.location = (100, 100)
                node_output_cycles.target = "CYCLES"
                links.new(node_geometry.outputs[6], node_mix_1.inputs[0])
                links.new(node_color.outputs[0], node_mix_1.inputs[1])
                links.new(node_transparency.outputs[0], node_mix_1.inputs[2])
                links.new(node_lightpath.outputs[0], node_mix_2.inputs[0])
                links.new(node_transparency.outputs[0], node_mix_2.inputs[1])
                links.new(node_mix_1.outputs[0], node_mix_2.inputs[2])
                links.new(node_lightpath.outputs[3], node_mix_3.inputs[0])
                links.new(node_mix_2.outputs[0], node_mix_3.inputs[1])
                links.new(node_mix_1.outputs[0], node_mix_3.inputs[2])
                links.new(node_mix_3.outputs[0], node_output_cycles.inputs[0])
            if mat_name not in [m.name for m in obj.data.materials if m]:
                obj.data.materials.append(mat)
            if obj.type == "MESH":
                vg_outline = obj.vertex_groups.get("OH_Outline_VertexGroup")
                if not vg_outline:
                    vg_outline = obj.vertex_groups.new(name="OH_Outline_VertexGroup")
                    for vert in obj.data.vertices:
                        vg_outline.add([vert.index], 1.0, "ADD")
            mod = obj.modifiers.get("OH_OUTLINE")
            if mod:
                mod.thickness = -scene.oh_outline_thickness
            else:
                mod = obj.modifiers.new("OH_OUTLINE", "SOLIDIFY")
                mod.use_flip_normals = True
                mod.use_rim = False
                if obj.type == "MESH":
                    mod.vertex_group = "OH_Outline_VertexGroup"
                mod.thickness = -scene.oh_outline_thickness
                mod.material_offset = 999
        return {"FINISHED"}
class VIEW3D_OT_export_mdl(bpy.types.Operator):
    bl_idname = "view3d.export_mdl"
    bl_label = "导出MDL"
    filepath: bpy.props.StringProperty(name="文件路径", maxlen=1024, default="", subtype='FILE_PATH')
    filter_glob: bpy.props.StringProperty(default="*.mdl", options={'HIDDEN'})
    @requires_license
    def execute(self, context):
        original_selection = context.selected_objects.copy()
        original_active = context.view_layer.objects.active
        try:
            bpy.ops.war3.add_mdl_layer_to_all_materials()
            self.report({'INFO'}, "已为所有材质添加MDL图层")
        except Exception as e:
            try:
                self.add_mdl_layers_fallback(context)
            except Exception as e2:
                self.report({'ERROR'}, f"备用方法也失败: {str(e2)}")
        bpy.ops.object.select_all(action='DESELECT')
        for obj in original_selection:
            obj.select_set(True)
        context.view_layer.objects.active = original_active
        try:
            bpy.ops.export.mdl_exporter(
                filepath=self.filepath,
                check_existing=True,
                filter_glob="*.mdl",
                use_selection=False,
                global_scale=60,
                optimize_animation=context.scene.mdl_export_optimize_animation,
                optimize_tolerance=context.scene.mdl_export_optimize_tolerance,
                axis_forward='-X',
                axis_up='Z'
            )
            self.report({'INFO'}, f"MDL导出成功: {self.filepath}")
            if context.scene.convert_blp_textures:
                mdl_dir = os.path.dirname(self.filepath)
                success, message = convert_blp_textures(context, mdl_dir)
                if success:
                    self.report({'INFO'}, message)
                else:
                    self.report({'WARNING'}, message)
            self.report({'INFO'}, "转换完成！请注意：转换后的模型需要手动分层。")
        except Exception as e:
            self.report({'ERROR'}, f"MDL导出失败: {str(e)}")
            return {'CANCELLED'}
        return {'FINISHED'}
    def add_mdl_layers_fallback(self, context):
        all_materials = set()
        for obj in context.scene.objects:
            if hasattr(obj, 'material_slots'):
                for slot in obj.material_slots:
                    if slot.material:
                        all_materials.add(slot.material)
        for mat in all_materials:
            if not hasattr(mat, 'mdl_layers'):
                if not hasattr(bpy.types.Material, 'mdl_layers'):
                    bpy.types.Material.mdl_layers = bpy.props.CollectionProperty(type=mdl_layer_utils.MDLLayerProperties)
                if not hasattr(bpy.types.Material, 'mdl_layer_index'):
                    bpy.types.Material.mdl_layer_index = bpy.props.IntProperty(default=0)
            if len(mat.mdl_layers) == 0:
                item = mat.mdl_layers.add()
                item.name = "Layer 1"
                item.texture_type = '0'
                item.filter_mode = 'None'
                item.alpha = 1.0
                item.unshaded = True
                item.two_sided = False
                item.no_depth_test = False
                item.no_depth_set = False
                if mat.use_nodes:
                    texture_found = False
                    for node in mat.node_tree.nodes:
                        if node.type == 'TEX_IMAGE' and node.image:
                            if node.image.filepath:
                                filepath = node.image.filepath
                                filename = os.path.basename(filepath)
                                base_name = os.path.splitext(filename)[0]
                                item.path = f"{base_name}.blp"
                            else:
                                image_name = node.image.name
                                base_name = os.path.splitext(image_name)[0]
                                item.path = f"{base_name}.blp"
                            texture_found = True
                            break
                    if not texture_found:
                        mat_name = mat.name
                        if "." in mat_name and mat_name[-3:].isdigit():
                            mat_name = mat_name[:-4]
                        item.path = f"{mat_name}.blp"
                else:
                    item.path = "Textures\\white.blp"
    def invoke(self, context, event):
        if hasattr(context.scene, 'last_imported_fbx_path') and context.scene.last_imported_fbx_path:
            fbx_path = context.scene.last_imported_fbx_path
            default_path = os.path.splitext(fbx_path)[0] + ".mdl"
            self.filepath = default_path
        context.window_manager.fileselect_add(self)
        return {'RUNNING_MODAL'}
def get_animation_actions():
    animation_actions = []
    for action in bpy.data.actions:
        if action and action.name:
            has_bone_animation = False
            for fcurve in action.fcurves:
                if fcurve.data_path.startswith('pose.bones['):
                    has_bone_animation = True
                    break
            if has_bone_animation:
                animation_actions.append(action)
    return animation_actions
def export_animation_info_txt(filepath, actions_info):
    try:
        if not filepath.lower().endswith('.txt'):
            filepath += '.txt'
        with open(filepath, 'w') as file:
            file.write("Name,StartFrame,EndFrame\n")
            for name, start_frame, end_frame in actions_info:
                file.write(f"{name},{start_frame},{end_frame}\n")
        return True
    except Exception:
        return False
def get_selected_actions(context, use_fallback=True):
    selected_actions = []
    try:
        settings = context.scene.action_merge_settings
        for item in settings.action_items:
            if item.use:
                action = bpy.data.actions.get(item.name)
                if action:
                    selected_actions.append(action)
        if use_fallback and len(selected_actions) == 0:
            selected_actions = get_animation_actions()
        return selected_actions
    except Exception:
        if use_fallback:
            return get_animation_actions()
        return []
class SimpleFBXExport(Operator):
    bl_idname = "export_scene.simple_fbx"
    bl_label = "导出合并FBX"
    bl_options = {'REGISTER', 'UNDO'}
    filepath: StringProperty(name="文件路径", maxlen=1024, subtype='FILE_PATH')
    my_animation_type: EnumProperty(
        name="动画类型",
        items=(('Active', "活动动画", "导出活动动画"),
               ('Actions', "所有动作", "导出所有动作"),
               ('Tracks', "所有NLA轨道", "导出所有NLA轨道"),
               ('SelectedActions', "勾选动作", "只导出勾选动作")),
        default='SelectedActions',
    )
    my_animation_offset: IntProperty(name="动画偏移", default=50, min=-1000000, max=1000000)
    export_frame_offset: IntProperty(name="全局帧偏移", default=-1, min=-1000, max=1000)
    use_concatenate_all: BoolProperty(name="连接所有动画", default=True)
    use_timeline_range: BoolProperty(name="使用时间线范围", default=False)
    use_driver_based_shape_key: BoolProperty(name="基于驱动的形状键", default=False)
    export_txt_annotation: BoolProperty(name="导出TXT注释", default=True)
    def invoke(self, context, event):
        context.window_manager.fileselect_add(self)
        return {'RUNNING_MODAL'}
    def execute(self, context):
        try:
            animation_actions = []
            if self.export_txt_annotation:
                animation_actions = get_selected_actions(context, use_fallback=True)
                if len(animation_actions) == 0:
                    self.report({'WARNING'}, "没有找到任何动作，导出的FBX将不包含动画")
                else:
                    settings = context.scene.action_merge_settings
                    selected_count = sum(1 for item in settings.action_items if item.use)
                    if selected_count == 0:
                        self.report({'INFO'}, "未勾选动作，已自动使用所有可用动作")
                    else:
                        self.report({'INFO'}, f"已使用 {selected_count} 个勾选的动作")
            total_offset = self.my_animation_offset + self.export_frame_offset
            if hasattr(context.scene, 'action_frame_ranges'):
                context.scene.action_frame_ranges.clear()
            bpy.ops.better_export.fbx(
                filepath=self.filepath,
                use_animation=True,
                use_timeline_range=self.use_timeline_range,
                my_animation_offset=self.my_animation_offset,
                use_driver_based_shape_key=self.use_driver_based_shape_key,
                my_animation_type=self.my_animation_type,
                use_concatenate_all=self.use_concatenate_all,
                use_selection=False,
                use_active_collection=False,
                use_visible=False,
                use_only_deform_bones=False,
                use_only_selected_deform_bones=False,
                my_max_bone_influences='Unlimited',
                primary_bone_axis='Y',
                secondary_bone_axis='X',
                use_rigify_armature=False,
                use_rigify_root_bone=True,
                my_scale=10.0,
                use_optimize_for_game_engine=False,
                use_reset_mesh_origin=False,
                use_reset_mesh_rotation=False,
                use_only_root_empty_node=False,
                use_ignore_armature_node=False,
                use_edge_crease=True,
                my_edge_smoothing='FBXSDK',
                my_edge_crease_scale=1.0,
                my_separate_files=False,
                use_move_to_origin=False,
                my_material_style='Blender',
                use_embed_media=False,
                use_copy_texture=False,
                my_texture_subdirectory="textures",
                my_simplify_algorithm='0',
                my_simplify_keyframe_factor=1.0,
                use_unroll_filter=False,
                use_independent_animation_stack=False,
                use_apply_modifiers=True,
                use_include_armature_deform_modifier=False,
                use_triangulate=False,
                use_tangents=True,
                use_raw_normals_and_raw_tangents=False,
                my_fbx_format='binary',
                my_fbx_version='FBX201800',
                my_fbx_axis='MayaZUp',
                my_fbx_unit='cm',
                use_vertex_animation=False,
                use_vertex_format='mcx',
                use_vertex_space='world',
                my_vertex_frame_start=1,
                my_vertex_frame_end=10
            )
            if self.export_txt_annotation and animation_actions:
                fbx_dir = os.path.dirname(self.filepath)
                fbx_name = os.path.splitext(os.path.basename(self.filepath))[0]
                txt_filepath = os.path.join(fbx_dir, f"{fbx_name}_animation_info.txt")
                actions_info = []
                if hasattr(context.scene, 'action_frame_ranges') and len(context.scene.action_frame_ranges) > 0:
                    for item in context.scene.action_frame_ranges:
                        txt_start_frame = item.start_frame + self.export_frame_offset
                        txt_end_frame = item.end_frame + self.export_frame_offset
                        actions_info.append((item.name, txt_start_frame, txt_end_frame))
                else:
                    FIXED_OFFSET = 9
                    current_frame = 1 + FIXED_OFFSET
                    for i, action in enumerate(animation_actions):
                        action_start = int(action.frame_range[0])
                        action_end = int(action.frame_range[1])
                        action_length = action_end - action_start + 1
                        fbx_start = current_frame
                        fbx_end = current_frame + action_length - 1
                        txt_start = fbx_start + self.export_frame_offset
                        txt_end = fbx_end + self.export_frame_offset
                        actions_info.append((action.name, txt_start, txt_end))
                        if i < len(animation_actions) - 1:
                            current_frame = fbx_end + self.my_animation_offset + 1
                        else:
                            current_frame = fbx_end + 1
                if export_animation_info_txt(txt_filepath, actions_info):
                    self.report({'INFO'}, f"FBX导出完成，动画信息已保存到: {txt_filepath}")
                else:
                    self.report({'WARNING'}, "FBX导出完成，但动画信息保存失败")
            else:
                self.report({'INFO'}, "FBX导出完成")
            return {'FINISHED'}
        except Exception as e:
            self.report({'ERROR'}, f"导出失败: {str(e)}")
            return {'CANCELLED'}
    def draw(self, context):
        layout = self.layout
        layout.label(text="动画导出设置:")
        layout.prop(self, 'my_animation_type')
        layout.prop(self, 'my_animation_offset')
        layout.prop(self, 'export_frame_offset')
        layout.prop(self, 'use_concatenate_all')
        layout.prop(self, 'use_timeline_range')
        layout.prop(self, 'use_driver_based_shape_key')
        layout.separator()
        layout.prop(self, 'export_txt_annotation')
class ACTION_OT_convert_to_mdl(bpy.types.Operator):
    bl_idname = "action.convert_to_mdl"
    bl_label = "一键转换MDL"
    filepath: bpy.props.StringProperty(name="文件路径", maxlen=1024, default="", subtype='FILE_PATH')
    filter_glob: bpy.props.StringProperty(default="*.fbx", options={'HIDDEN'})
    @requires_license
    def execute(self, context):
        try:
            bpy.ops.better_import.fbx(
                filepath=self.filepath,
                my_scale=context.scene.simple_fbx_my_scale,
                use_auto_bone_orientation=True,
                my_calculate_roll='None',
                my_bone_length=1.0,
                my_leaf_bone='Short',
                use_fix_bone_poses=False,
                use_fix_attributes=True,
                use_only_deform_bones=False,
                primary_bone_axis='Y',
                secondary_bone_axis='X',
                use_vertex_animation=True,
                use_animation=True,
                use_attach_to_selected_armature=False,
                my_animation_offset=0,
                use_animation_prefix=False,
                use_pivot=False,
                use_triangulate=False,
                my_import_normal='Import',
                use_auto_smooth=True,
                my_angle=30.0,
                my_shade_mode='Smooth',
                use_optimize_for_blender=False,
                use_reset_mesh_origin=True,
                use_reset_mesh_rotation=True,
                use_edge_crease=True,
                my_edge_crease_scale=1.0,
                my_edge_smoothing='FBXSDK',
                use_detect_deform_bone=True,
                use_import_materials=True,
                use_rename_by_filename=False,
                use_fix_mesh_scaling=False,
                my_rotation_mode='XYZ',
                my_fbx_unit='cm'
            )
            context.scene.last_imported_fbx_path = self.filepath
        except Exception as e:
            file_basename = os.path.basename(self.filepath) if self.filepath else "未知文件"
            self.report({'ERROR'}, f"FBX导入失败 {file_basename}: {str(e)}")
            return {'CANCELLED'}
        armature = None
        for obj in context.scene.objects:
            if obj.type == 'ARMATURE':
                armature = obj
                break
        if not armature:
            self.report({'ERROR'}, "场景中没有找到骨架")
            return {'CANCELLED'}
        bpy.ops.object.select_all(action='DESELECT')
        armature.select_set(True)
        context.view_layer.objects.active = armature
        bpy.ops.action.refresh_actions()
        settings = context.scene.action_merge_settings
        for item in settings.action_items:
            item.use = True
        try:
            bpy.ops.action.merge()
        except Exception as e:
            self.report({'ERROR'}, f"动作合并失败: {str(e)}")
            return {'CANCELLED'}
        mesh_objects = [obj for obj in context.scene.objects if obj.type == 'MESH']
        original_selection = context.selected_objects.copy()
        original_active = context.view_layer.objects.active
        bpy.ops.view3d.add_camera()
        for mesh_obj in mesh_objects:
            bpy.ops.object.select_all(action='DESELECT')
            mesh_obj.select_set(True)
            context.view_layer.objects.active = mesh_obj
            if context.active_object and context.active_object.mode != 'OBJECT':
                bpy.ops.object.mode_set(mode='OBJECT')
            try:
                bpy.ops.war3.add_mdl_layer_to_all_materials()
                self.report({'INFO'}, "已为所有材质添加MDL图层")
            except Exception as e:
                self.report({'WARNING'}, f"添加MDL图层时出错: {str(e)}")
        bpy.ops.object.select_all(action='DESELECT')
        for obj in original_selection:
            obj.select_set(True)
        context.view_layer.objects.active = original_active
        mdl_path = os.path.splitext(self.filepath)[0] + ".mdl"
        try:
            bpy.ops.object.select_all(action='SELECT')
            bpy.ops.export.mdl_exporter(
                filepath=mdl_path,
                check_existing=True,
                filter_glob="*.mdl",
                use_selection=False,
                global_scale=60,
                optimize_animation=context.scene.mdl_export_optimize_animation,
                optimize_tolerance=context.scene.mdl_export_optimize_tolerance,
                axis_forward='-X',
                axis_up='Z'
            )
            self.report({'INFO'}, f"MDL导出成功: {mdl_path}")
        except Exception as e:
            self.report({'ERROR'}, f"MDL导出失败: {str(e)}")
            return {'CANCELLED'}
        if context.scene.convert_blp_textures:
            fbx_dir = os.path.dirname(self.filepath)
            success, message = convert_blp_textures(context, fbx_dir)
            if success:
                self.report({'INFO'}, message)
            else:
                self.report({'WARNING'}, message)
        bpy. ops.animation.refresh_list()
        self.report({'INFO'}, "转换完成！请注意：转换后的模型需要手动分层。")
        return {'FINISHED'}
    def invoke(self, context, event):
        context.window_manager.fileselect_add(self)
        return {'RUNNING_MODAL'}
class ActionItem(bpy.types.PropertyGroup):
    name: bpy.props.StringProperty(name="动作名称")
    use: bpy.props.BoolProperty(name="使用", default=False)
    is_playing: bpy.props.BoolProperty(name="正在播放", default=False)
class ACTION_OT_select_all_actions(bpy.types.Operator):
    bl_idname = "action.select_all_actions"
    bl_label = "全选动作"
    select: bpy.props.BoolProperty(default=True)
    @requires_license
    def execute(self, context):
        settings = context.scene.action_merge_settings
        if not settings.action_items:
            self.report({'WARNING'}, "动作列表为空")
            return {'CANCELLED'}
        for item in settings.action_items:
            item.use = self.select
        action_type = "全选" if self.select else "取消全选"
        self.report({'INFO'}, f"已{action_type} {len(settings.action_items)} 个动作")
        return {'FINISHED'}
class ACTION_OT_refresh_actions(bpy.types.Operator):
    bl_idname = "action.refresh_actions"
    bl_label = "刷新动作列表"
    @requires_license
    def execute(self, context):
        settings = context.scene.action_merge_settings
        settings.action_items.clear()
        valid_actions = []
        # 默认使用单骨架模式：只显示当前骨架的动作
        self.report({'INFO'}, "正在加载选中骨架的动作...")
        selected_armatures = [obj for obj in context.selected_objects if obj.type == 'ARMATURE']
        if not selected_armatures:
            if context.active_object and context.active_object.type == 'ARMATURE':
                selected_armatures = [context.active_object]
            else:
                self.report({'ERROR'}, "请先在3D视图中选择一个骨架对象")
                return {'CANCELLED'}
        active_armature_bone_names = set()
        armature_names = []
        for arm in selected_armatures:
            active_armature_bone_names.update(arm.data.bones.keys())
            armature_names.append(arm.name)
        if not active_armature_bone_names:
            self.report({'WARNING'}, "所选骨架没有骨骼")
            return {'FINISHED'}
        for action in bpy.data.actions:
            if not (action and action.name):
                continue
            action_belongs_to_this_armature = False
            for fcurve in action.fcurves:
                if not fcurve.data_path.startswith('pose.bones["'):
                    continue
                match = re.search(r'pose\.bones\["([^"]+)"\]', fcurve.data_path)
                if not match:
                    continue
                bone_name = match.group(1)
                if bone_name in active_armature_bone_names:
                    action_belongs_to_this_armature = True
                    break
            if action_belongs_to_this_armature:
                valid_actions.append(action)
        for action in valid_actions:
            item = settings.action_items.add()
            item.name = action.name
            item.use = False
        bpy.context.scene.frame_set(bpy.context.scene.frame_current)
        for window in bpy.context.window_manager.windows:
            for area in window.screen.areas:
                if area.type in ('DOPESHEET_EDITOR', 'NLA_EDITOR', 'PROPERTIES'):
                    area.tag_redraw()
        self.report({'INFO'}, f"已刷新 {len(settings.action_items)} 个动作")
        return {'FINISHED'}  
class ACTION_OT_clean_anim_data(bpy.types.Operator):
    bl_idname = "action.clean_anim_data"
    bl_label = "清理动画数据"
    @requires_license
    def execute(self, context):
        actions = list(bpy.data.actions)
        for action in actions:
            bpy.data.actions.remove(action)
        markers_count = self.clear_timeline_markers(context)
        clips_count = self.clear_animation_clips(context)
        bpy.ops.action.refresh_actions()
        bpy.ops.animation.refresh_list()
        message = f"已删除 {len(actions)} 个动作数据"
        if markers_count > 0:
            message += f", {markers_count} 个时间轴标记"
        if clips_count > 0:
            message += f", {clips_count} 个动画片段"
        self.report({'INFO'}, message)
        return {'FINISHED'}
    def clear_timeline_markers(self, context):
        markers_count = len(context.scene.timeline_markers)
        while context.scene.timeline_markers:
            context.scene.timeline_markers.remove(context.scene.timeline_markers[0])
        return markers_count
    def clear_animation_clips(self, context):
        clips_count = len(context.scene.animation_clips)
        context.scene.animation_clips.clear()
        context.scene.animation_list_index = 0
        return clips_count
class ACTION_OT_merge(bpy.types.Operator):
    bl_idname = "action.merge"
    bl_label = "合并动作"
    _epsilon = 0.0001
    def _keyframe_exists(self, fcurve_or_points, frame):
        try:
            points = fcurve_or_points.keyframe_points
        except:
            points = fcurve_or_points
        for kf in points:
            if abs(kf.co[0] - frame) < self._epsilon:
                return True
        return False
    def clean_action_name(self, name, mapping_rules=None, used_names=None, use_semantic_rules=False):
        if used_names is None:
            used_names = {}
        if mapping_rules is None:
            mapping_rules = {}
        mapped_name = self.apply_mapping_rules(name, mapping_rules)
        if mapped_name and mapped_name != name:
            final_name = self.handle_duplicate_names(mapped_name, used_names)
            return final_name
        cleaned = name
        cleaned = re.sub(r'[._]\d+$', '', name)
        if '|' in cleaned:
            cleaned = cleaned.split('|', 1)[-1]
        if use_semantic_rules:
            cleaned = re.sub(r'[._](Wep\d+|Weapon)', '', cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r'[._](Body|Main|Arm|Leg)$', '', cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r'^(Body|Weapon|Armature|Main)[._]', '', cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r'^\d+[_\s]*', '', cleaned)
        cleaned = re.sub(r'[_\s-]+$', '', cleaned)
        cleaned = re.sub(r'(?i)_?(start|begin|end|finish)$', '', cleaned)
        final_name = cleaned.strip()
        if not final_name:
            final_name = name
        final_name = self.handle_duplicate_names(final_name, used_names)
        return final_name
    def apply_mapping_rules(self, name, mapping_rules):
        if not mapping_rules:
            return None
        for group_name, rules in mapping_rules.items():
            for pattern, replacement in rules.items():
                try:
                    if re.search(pattern, name, re.IGNORECASE):
                        return replacement
                except re.error: pass
        return None
    def handle_duplicate_names(self, base_name, used_names):
        if base_name not in used_names:
            used_names[base_name] = 1
            return base_name
        else:
            used_names[base_name] += 1
            new_name = f"{base_name}{used_names[base_name]}"
            return new_name
    def insert_rest_pose_keyframes(self, context, obj, frame):
        current_mode = obj.mode
        if context.view_layer.objects.active != obj:
            context.view_layer.objects.active = obj
        if current_mode != 'POSE':
            try:
                bpy.ops.object.mode_set(mode='POSE')
            except Exception as e:
                pass
        if obj.mode != 'POSE':
            return
        for pbone in obj.pose.bones:
            pbone.location = (0.0, 0.0, 0.0)
            pbone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
            pbone.rotation_euler = (0.0, 0.0, 0.0)
            pbone.scale = (1.0, 1.0, 1.0)
            pbone.keyframe_insert(data_path="location", frame=frame)
            if pbone.rotation_mode == 'QUATERNION':
                pbone.keyframe_insert(data_path="rotation_quaternion", frame=frame)
            else:  
                pbone.keyframe_insert(data_path="rotation_euler", frame=frame)
            pbone.keyframe_insert(data_path="scale", frame=frame)
        if current_mode != 'POSE':
            try:
                bpy.ops.object.mode_set(mode=current_mode)
            except Exception:
                pass
    def insert_object_level_keyframes(self, obj, frame):
        has_keyframe = False 
        if obj.animation_data and obj.animation_data.action:
            action = obj.animation_data.action
            for fcurve in action.fcurves:
                if fcurve.data_path in ["location", "rotation_euler", "rotation_quaternion", "scale"]:
                    if self._keyframe_exists(fcurve, frame):
                        has_keyframe = True
                        break
                if has_keyframe:
                    break
        if has_keyframe:
            return
        current_frame = bpy.context.scene.frame_current
        bpy.context.scene.frame_set(frame)
        obj.keyframe_insert(data_path="location", frame=frame)
        obj.keyframe_insert(data_path="rotation_euler", frame=frame)
        obj.keyframe_insert(data_path="scale", frame=frame)
        bpy.context.scene.frame_set(current_frame)
    def clear_timeline_markers(self, context):
        markers_count = len(context.scene.timeline_markers)
        while context.scene.timeline_markers:
            context.scene.timeline_markers.remove(context.scene.timeline_markers[0])
        return markers_count
    def clear_armature_animation_data(self, obj):
        if not obj.animation_data:
            return False
        for track in obj.animation_data.nla_tracks:
            obj.animation_data.nla_tracks.remove(track)
        obj.animation_data.action = None
        return True
    def preprocess_action_boundaries(self, action):
        if not action or not action.fcurves:
            return
        frame_range = action.frame_range
        start_frame = frame_range[0]
        end_frame = frame_range[1]
        for fcurve in action.fcurves:
            if not self._keyframe_exists(fcurve, start_frame):
                value = fcurve.evaluate(start_frame)
                fcurve.keyframe_points.insert(start_frame, value, options={'NEEDED', 'FAST'})
            if not self._keyframe_exists(fcurve, end_frame):
                value = fcurve.evaluate(end_frame)
                fcurve.keyframe_points.insert(end_frame, value, options={'NEEDED', 'FAST'})
            fcurve.update()
    @requires_license
    def execute(self, context):
        settings = context.scene.action_merge_settings
        all_armatures = [obj for obj in context.scene.objects if obj.type == 'ARMATURE']
        if not all_armatures:
            self.report({'ERROR'}, "场景中没有找到骨架。")
            return {'CANCELLED'}
        selected_actions_items = [item for item in settings.action_items if item.use]
        if not selected_actions_items:
            selected_actions = get_animation_actions() 
            if not selected_actions:
                 self.report({'ERROR'}, "请至少选择一个要合并的动作。")
                 return {'CANCELLED'}
        else:
            selected_actions = []
            for item in selected_actions_items:
                action = bpy.data.actions.get(item.name)
                if action:
                    self.preprocess_action_boundaries(action)
                    selected_actions.append(action)
        bone_to_armature_map = {}
        for arm in all_armatures:
            for bone_name in arm.data.bones.keys():
                bone_to_armature_map[bone_name] = arm
        action_to_armature_map = {}
        for action in selected_actions:
            found_armature = None
            for fcurve in action.fcurves:
                if fcurve.data_path.startswith('pose.bones["'):
                    match = re.search(r'pose\.bones\["([^"]+)"\]', fcurve.data_path)
                    if match:
                        bone_name = match.group(1)
                        if bone_name in bone_to_armature_map:
                            found_armature = bone_to_armature_map[bone_name]
                            break
                if found_armature:
                    break
            if found_armature:
                action_to_armature_map[action.name] = found_armature
        final_selected_actions = [action for action in selected_actions if action.name in action_to_armature_map]
        if not final_selected_actions:
            self.report({'ERROR'}, "所选动作中没有找到任何属于场景中骨架的动画曲线。")
            return {'CANCELLED'}
        mapping_rules = load_action_mapping()
        used_clip_names = {}
        grouped_actions = {}
        temp_used_names = {}
        for action in final_selected_actions:
            group_name = action.name
            if group_name not in grouped_actions:
                grouped_actions[group_name] = []
            grouped_actions[group_name].append(action)
        master_timeline = {}
        action_clips_info = []
        current_frame = settings.start_frame + settings.start_offset
        for group_name, actions_in_group in grouped_actions.items():
            max_length = 0
            for action in actions_in_group:
                frame_range = action.frame_range
                action_length = int(frame_range[1] - frame_range[0] + 1)
                max_length = max(max_length, action_length)
            if max_length == 0: continue
            start_frame = current_frame
            end_frame = current_frame + max_length - 1
            master_timeline[group_name] = {"start": start_frame, "end": end_frame, "actions": actions_in_group}
            # 根据 use_original_name 决定是否使用原始名称
            if settings.use_original_name:
                unique_clip_name = self.handle_duplicate_names(group_name, used_clip_names)
            else:
                unique_clip_name = self.handle_duplicate_names(self.clean_action_name(group_name, mapping_rules), used_clip_names)
            action_clips_info.append((unique_clip_name, start_frame, end_frame))
            current_frame = end_frame + settings.frame_offset + 1
        final_start_frame = settings.start_frame
        final_end_frame = current_frame - settings.frame_offset - 1
        context.scene.frame_start = final_start_frame
        context.scene.frame_end = final_end_frame
        if context.mode != 'OBJECT':
            try: bpy.ops.object.mode_set(mode='OBJECT')
            except: pass
        for obj in all_armatures:
            if obj.rotation_mode != 'XYZ':
                obj.rotation_mode = 'XYZ'
            obj.rotation_euler = (0.0, 0.0, 0.0)
        bpy.context.view_layer.update()
        for obj in all_armatures:
            self.clear_armature_animation_data(obj)
        for obj in all_armatures:
            merged_action_obj = bpy.data.actions.new(name=f"Merged_Action_{obj.name}")
            fcurve_data_map_obj = {} 
            for group_name, timeline_info in master_timeline.items():
                for action in timeline_info["actions"]:
                    mapped_armature = action_to_armature_map.get(action.name)
                    if mapped_armature != obj:
                        continue
                    frame_range = action.frame_range
                    if not (frame_range and frame_range[0] != frame_range[1]):
                        continue 
                    frame_offset = timeline_info["start"] - frame_range[0]
                    for fcurve in action.fcurves:
                        is_valid_fcurve = False
                        if obj.type == 'ARMATURE' and fcurve.data_path.startswith("pose.bones["):
                            is_valid_fcurve = True
                        if is_valid_fcurve:
                            key = (fcurve.data_path, fcurve.array_index)
                            if key not in fcurve_data_map_obj:
                                fcurve_data_map_obj[key] = []
                            for kf in fcurve.keyframe_points:
                                fcurve_data_map_obj[key].append(
                                    ((kf.co[0] + frame_offset, kf.co[1]), 
                                     (kf.handle_left[0] + frame_offset, kf.handle_left[1]), 
                                     (kf.handle_right[0] + frame_offset, kf.handle_right[1]), 
                                     kf.interpolation)
                                )
            for key, processed_keyframes in fcurve_data_map_obj.items():
                data_path, array_index = key
                new_fcurve = merged_action_obj.fcurves.new(data_path=data_path, index=array_index)
                count = len(processed_keyframes)
                if count == 0:
                    merged_action_obj.fcurves.remove(new_fcurve)
                    continue
                new_fcurve.keyframe_points.add(count)
                flat_co_list = [0.0] * (count * 2)
                flat_hl_list = [0.0] * (count * 2)
                flat_hr_list = [0.0] * (count * 2)
                try:
                    for i, (co, hl, hr, interp) in enumerate(processed_keyframes):
                        flat_co_list[i*2] = co[0]; flat_co_list[i*2 + 1] = co[1]
                        flat_hl_list[i*2] = hl[0]; flat_hl_list[i*2 + 1] = hl[1]
                        flat_hr_list[i*2] = hr[0]; flat_hr_list[i*2 + 1] = hr[1]
                    new_fcurve.keyframe_points.foreach_set("co", flat_co_list)
                    new_fcurve.keyframe_points.foreach_set("handle_left", flat_hl_list)
                    new_fcurve.keyframe_points.foreach_set("handle_right", flat_hr_list)
                    for i, (co, hl, hr, interp) in enumerate(processed_keyframes):
                        new_fcurve.keyframe_points[i].interpolation = interp
                    new_fcurve.update()
                except Exception as e:
                    self.report({'WARNING'}, f"为 {obj.name} 写入F-Curve {data_path}[{array_index}] 时出错: {e}")
                    try:
                        merged_action_obj.fcurves.remove(new_fcurve)
                    except:
                        pass
            if merged_action_obj.fcurves:
                 if not obj.animation_data:
                     obj.animation_data_create()
                 obj.animation_data.action = merged_action_obj
            else:
                 bpy.data.actions.remove(merged_action_obj)
                 self.clear_armature_animation_data(obj) 
        final_armatures_to_process = []
        if context.mode != 'OBJECT':
            try: bpy.ops.object.mode_set(mode='OBJECT')
            except: pass
        for obj in all_armatures:
            bpy.ops.object.select_all(action='DESELECT')
            obj.select_set(True)
            context.view_layer.objects.active = obj
            if obj.parent:
                bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
            if obj.rotation_mode != 'XYZ':
                obj.rotation_mode = 'XYZ'
            obj.rotation_euler = (0.0, 0.0, 0.0)
            if not settings.adaptive_scale:
                obj.scale = (1.0, 1.0, 1.0)
            if obj.animation_data and obj.animation_data.action:
                obj.keyframe_insert(data_path="rotation_euler", frame=0)
                obj.keyframe_insert(data_path="rotation_euler", frame=1)
                obj.keyframe_insert(data_path="rotation_euler", frame=final_start_frame)
                obj.keyframe_insert(data_path="scale", frame=0)
                obj.keyframe_insert(data_path="scale", frame=1)
                obj.keyframe_insert(data_path="scale", frame=final_start_frame)
            final_armatures_to_process.append(obj)
        for obj in final_armatures_to_process:
            self.insert_rest_pose_keyframes(context, obj, 0)
            self.insert_rest_pose_keyframes(context, obj, 1)
        self.clear_timeline_markers(context)
        context.scene.animation_clips.clear()
        for (clean_name, start_frame, end_frame) in action_clips_info:
            context.scene.timeline_markers.new(clean_name, frame=start_frame)
            context.scene.timeline_markers.new(clean_name, frame=end_frame)
            clip = context.scene.animation_clips.add()
            clip.name = clean_name; clip.start_frame = start_frame; clip.end_frame = end_frame
        context.scene.timeline_markers.new("zSX2530075955", frame=0)
        context.scene.timeline_markers.new("zSX2530075955", frame=1)
        scene_current_frame = context.scene.frame_current
        context.scene.frame_set(context.scene.frame_start)
        for obj in all_armatures:
             if obj.animation_data and obj.animation_data.action:
                 self.insert_object_level_keyframes(obj, context.scene.frame_start)
        context.scene.frame_set(scene_current_frame)
        bpy.context.view_layer.update()
        bpy.ops.animation.refresh_list()
        self.report({'INFO'}, f"成功合并 {len(final_selected_actions)} 个动作，应用到 {len(all_armatures)} 个骨架上")
        return {'FINISHED'}
    
class ANIM_OT_align_bone_to_origin(bpy.types.Operator):
    """归零当前选中片段的骨骼位移"""
    bl_idname = "anim.align_bone_to_origin"
    bl_label = "位移归零"
    bl_options = {'REGISTER', 'UNDO'}

    @classmethod
    def poll(cls, context):
        return (context.mode == 'POSE' and 
                context.object and context.object.type == 'ARMATURE' and
                context.selected_pose_bones and
                len(context.scene.animation_clips) > 0 and
                0 <= context.scene.animation_list_index < len(context.scene.animation_clips))

    def execute(self, context):
        # 许可证验证
        valid, message, expiry_date = validate_license_embedded()
        if not valid:
            self.report({'ERROR'}, "需要有效的许可证才能使用此功能")
            return {'CANCELLED'}
        
        scene = context.scene
        armature_obj = context.object
        selected_bones = context.selected_pose_bones
        
        # 获取当前选中的片段
        clip = scene.animation_clips[scene.animation_list_index]
        ranges = [(clip.start_frame, clip.end_frame)]
        
        # 执行归零
        count = self._process_zeroing(context, armature_obj, selected_bones, ranges)
        
        x_s = "保持X" if scene.keep_x_axis else "归零X"
        y_s = "保持Y" if scene.keep_y_axis else "归零Y"
        z_s = "保持Z" if scene.keep_z_axis else "归零Z"
        self.report({'INFO'}, f"归零完成 ({x_s}, {y_s}, {z_s})，处理了 {count} 帧")
        return {'FINISHED'}

    def _process_zeroing(self, context, armature_obj, bones, frame_ranges):
        """核心归零逻辑"""
        scene = context.scene
        use_world_space = getattr(scene, "use_world_space_tools", True)
        keep_x = scene.keep_x_axis
        keep_y = scene.keep_y_axis
        keep_z = scene.keep_z_axis
        
        frames = set()
        for s, e in frame_ranges:
            for f in range(s, e + 1):
                frames.add(f)
        sorted_frames = sorted(list(frames))
        current_frame = scene.frame_current
        processed_count = 0
        
        try:
            for frame in sorted_frames:
                scene.frame_set(frame)
                context.view_layer.update()
                arm_world_inv = armature_obj.matrix_world.inverted()
                
                for pbone in bones:
                    if use_world_space:
                        current_world_mat = armature_obj.matrix_world @ pbone.matrix
                        current_loc = current_world_mat.translation
                        target_x = current_loc.x if keep_x else 0.0
                        target_y = current_loc.y if keep_y else 0.0
                        target_z = current_loc.z if keep_z else 0.0
                        current_world_mat.translation = Vector((target_x, target_y, target_z))
                        pbone.matrix = arm_world_inv @ current_world_mat
                    else:
                        current_loc = pbone.location
                        target_x = current_loc.x if keep_x else 0.0
                        target_y = current_loc.y if keep_y else 0.0
                        target_z = current_loc.z if keep_z else 0.0
                        pbone.location = Vector((target_x, target_y, target_z))
                    pbone.keyframe_insert(data_path="location", frame=frame)
                    processed_count += 1
        finally:
            scene.frame_set(current_frame)
            
        return processed_count


class ANIM_OT_align_all_bones_to_origin(bpy.types.Operator): 
    """归零所有片段的骨骼位移"""
    bl_idname = "anim.align_all_bones_to_origin"
    bl_label = "全部动画位移归零"
    bl_options = {'REGISTER', 'UNDO'}
    
    @classmethod
    def poll(cls, context):
        return (context.mode == 'POSE' and 
                context.object and context.object.type == 'ARMATURE' and
                context.selected_pose_bones and
                len(context.scene.animation_clips) > 0)

    def execute(self, context):
        # 许可证验证
        valid, message, expiry_date = validate_license_embedded()
        if not valid:
            self.report({'ERROR'}, "需要有效的许可证才能使用此功能")
            return {'CANCELLED'}
        
        scene = context.scene
        armature_obj = context.object
        selected_bones = context.selected_pose_bones
        
        # 获取所有片段
        ranges = []
        for clip in scene.animation_clips:
            ranges.append((clip.start_frame, clip.end_frame))
            
        # 执行归零
        count = self._process_zeroing(context, armature_obj, selected_bones, ranges)
        
        self.report({'INFO'}, f"全部归零完成，共处理 {count} 帧")
        return {'FINISHED'}

    def _process_zeroing(self, context, armature_obj, bones, frame_ranges):
        """核心归零逻辑"""
        scene = context.scene
        use_world_space = getattr(scene, "use_world_space_tools", True)
        keep_x = scene.keep_x_axis
        keep_y = scene.keep_y_axis
        keep_z = scene.keep_z_axis
        
        frames = set()
        for s, e in frame_ranges:
            for f in range(s, e + 1):
                frames.add(f)
        sorted_frames = sorted(list(frames))
        current_frame = scene.frame_current
        processed_count = 0
        
        try:
            for frame in sorted_frames:
                scene.frame_set(frame)
                context.view_layer.update()
                arm_world_inv = armature_obj.matrix_world.inverted()
                
                for pbone in bones:
                    if use_world_space:
                        current_world_mat = armature_obj.matrix_world @ pbone.matrix
                        current_loc = current_world_mat.translation
                        target_x = current_loc.x if keep_x else 0.0
                        target_y = current_loc.y if keep_y else 0.0
                        target_z = current_loc.z if keep_z else 0.0
                        current_world_mat.translation = Vector((target_x, target_y, target_z))
                        pbone.matrix = arm_world_inv @ current_world_mat
                    else:
                        current_loc = pbone.location
                        target_x = current_loc.x if keep_x else 0.0
                        target_y = current_loc.y if keep_y else 0.0
                        target_z = current_loc.z if keep_z else 0.0
                        pbone.location = Vector((target_x, target_y, target_z))
                    pbone.keyframe_insert(data_path="location", frame=frame)
                    processed_count += 1
        finally:
            scene.frame_set(current_frame)
            
        return processed_count
    
class ANIM_OT_keyframe_move_normal(bpy.types.Operator):
    bl_idname = "anim.keyframe_move_normal"
    bl_label = "正常移动 (当前片段)"
    bl_options = {'REGISTER', 'UNDO'}
    @classmethod
    def poll(cls, context):
        return (context.mode == 'POSE' and 
                context.object and context.object.type == 'ARMATURE' and
                context.selected_pose_bones and
                len(context.scene.animation_clips) > 0 and
                context.scene.animation_list_index >= 0)
    def execute(self, context):
        scene = context.scene
        armature_obj = context.object
        selected_pbones = context.selected_pose_bones
        bone_names = [pbone.name for pbone in selected_pbones]
        clip = scene.animation_clips[scene.animation_list_index]
        frame_ranges = [(clip.start_frame, clip.end_frame)]
        offset = Vector((
            scene.keyframe_move_offset_x,
            scene.keyframe_move_offset_y,
            scene.keyframe_move_offset_z
        ))
        if offset.length == 0.0:
            self.report({'INFO'}, "偏移值为0, 未执行任何操作")
            return {'CANCELLED'}
        count = keyframe_utils.apply_offset_to_bones(armature_obj, bone_names, offset, frame_ranges)
        self.report({'INFO'}, f"为 {len(bone_names)} 根骨骼在 '{clip.name}' 片段中移动了 {count} 个关键帧")
        return {'FINISHED'}
class ANIM_OT_keyframe_move_normal_all(bpy.types.Operator):
    bl_idname = "anim.keyframe_move_normal_all"
    bl_label = "全部正常移动 (所有片段)"
    bl_options = {'REGISTER', 'UNDO'}
    @classmethod
    def poll(cls, context):
        return (context.mode == 'POSE' and 
                context.object and context.object.type == 'ARMATURE' and
                context.selected_pose_bones and
                len(context.scene.animation_clips) > 0)
    def execute(self, context):
        scene = context.scene
        armature_obj = context.object
        selected_pbones = context.selected_pose_bones
        bone_names = [pbone.name for pbone in selected_pbones]
        frame_ranges = [(c.start_frame, c.end_frame) for c in scene.animation_clips]
        offset = Vector((
            scene.keyframe_move_offset_x,
            scene.keyframe_move_offset_y,
            scene.keyframe_move_offset_z
        ))
        if offset.length == 0.0:
            self.report({'INFO'}, "偏移值为0, 未执行任何操作")
            return {'CANCELLED'}
        count = keyframe_utils.apply_offset_to_bones(armature_obj, bone_names, offset, frame_ranges)
        self.report({'INFO'}, f"为 {len(bone_names)} 根骨骼在 {len(frame_ranges)} 个片段中移动了 {count} 个关键帧")
        return {'FINISHED'}
class ANIM_OT_keyframe_rotate_normal(bpy.types.Operator):
    bl_idname = "anim.keyframe_rotate_normal"
    bl_label = "片段旋转"
    bl_options = {'REGISTER', 'UNDO'}
    @classmethod
    def poll(cls, context):
        return (context.mode == 'POSE' and 
                context.object and context.object.type == 'ARMATURE' and
                context.selected_pose_bones and
                len(context.scene.animation_clips) > 0 and
                context.scene.animation_list_index >= 0)
    def execute(self, context):
        scene = context.scene
        armature_obj = context.object
        selected_pbones = context.selected_pose_bones
        bone_names = [pbone.name for pbone in selected_pbones]
        clip = scene.animation_clips[scene.animation_list_index]
        offset = Vector((
            math.radians(scene.keyframe_rotate_offset_x),
            math.radians(scene.keyframe_rotate_offset_y),
            math.radians(scene.keyframe_rotate_offset_z)
        ))
        if offset.length == 0.0:
            self.report({'INFO'}, "旋转值为0, 未执行任何操作")
            return {'CANCELLED'}
        count = 0
        action = armature_obj.animation_data.action
        frame_ranges = [(clip.start_frame, clip.end_frame)]
        
        for pbone in selected_pbones:
            data_path = f'pose.bones["{pbone.name}"].rotation_euler'
            for i in range(3):
                fc = action.fcurves.find(data_path, index=i)
                if not fc: continue
                for kp in fc.keyframe_points:
                    in_range = False
                    for start, end in frame_ranges:
                        if start <= kp.co[0] <= end:
                            in_range = True
                            break
                    if in_range:
                        kp.co[1] += offset[i]
                        count += 1
                fc.update()
        self.report({'INFO'}, f"为 {len(bone_names)} 根骨骼在 '{clip.name}' 片段中旋转了 {count} 个关键帧")
        return {'FINISHED'}

class ANIM_OT_keyframe_rotate_normal_all(bpy.types.Operator):
    bl_idname = "anim.keyframe_rotate_normal_all"
    bl_label = "全部旋转"
    bl_options = {'REGISTER', 'UNDO'}
    @classmethod
    def poll(cls, context):
        return (context.mode == 'POSE' and 
                context.object and context.object.type == 'ARMATURE' and
                context.selected_pose_bones and
                len(context.scene.animation_clips) > 0)
    def execute(self, context):
        scene = context.scene
        armature_obj = context.object
        selected_pbones = context.selected_pose_bones
        bone_names = [pbone.name for pbone in selected_pbones]
        offset = Vector((
            math.radians(scene.keyframe_rotate_offset_x),
            math.radians(scene.keyframe_rotate_offset_y),
            math.radians(scene.keyframe_rotate_offset_z)
        ))
        if offset.length == 0.0:
            self.report({'INFO'}, "旋转值为0, 未执行任何操作")
            return {'CANCELLED'}
        count = 0
        action = armature_obj.animation_data.action
        frame_ranges = [(c.start_frame, c.end_frame) for c in scene.animation_clips]
        
        for pbone in selected_pbones:
            data_path = f'pose.bones["{pbone.name}"].rotation_euler'
            for i in range(3):
                fc = action.fcurves.find(data_path, index=i)
                if not fc: continue
                for kp in fc.keyframe_points:
                    in_range = False
                    for start, end in frame_ranges:
                        if start <= kp.co[0] <= end:
                            in_range = True
                            break
                    if in_range:
                        kp.co[1] += offset[i]
                        count += 1
                fc.update()
        self.report({'INFO'}, f"为 {len(bone_names)} 根骨骼在所有片段中旋转了 {count} 个关键帧")
        return {'FINISHED'}

class ANIM_OT_keyframe_move_smart(bpy.types.Operator):
    bl_idname = "anim.keyframe_move_smart"
    bl_label = "智能移动 (当前片段)"
    bl_options = {'REGISTER', 'UNDO'}
    @classmethod
    def poll(cls, context):
        return (context.mode == 'POSE' and 
                context.object and context.object.type == 'ARMATURE' and
                context.selected_pose_bones and
                len(context.scene.animation_clips) > 0 and
                context.scene.animation_list_index >= 0)
    def execute(self, context):
        scene = context.scene
        armature_obj = context.object
        selected_pbones = context.selected_pose_bones
        bone_names = [pbone.name for pbone in selected_pbones]
        clip = scene.animation_clips[scene.animation_list_index]
        frame_ranges = [(clip.start_frame, clip.end_frame)]
        current_frame = scene.frame_current
        scene.frame_set(clip.start_frame)
        offset = keyframe_utils.get_smart_offset(context, armature_obj)
        scene.frame_set(current_frame)
        if not offset:
            self.report({'ERROR'}, "无法计算智能偏移 (找不到骨架或子网格)")
            return {'CANCELLED'}
        count = keyframe_utils.apply_offset_to_bones(armature_obj, bone_names, offset, frame_ranges)
        self.report({'INFO'}, f"智能偏移 {offset.to_tuple(2)} 应用于 '{clip.name}' 片段, 移动了 {count} 个关键帧")
        return {'FINISHED'}
class ANIM_OT_keyframe_move_smart_all(bpy.types.Operator):
    bl_idname = "anim.keyframe_move_smart_all"
    bl_label = "全部智能移动 (所有片段)"
    bl_options = {'REGISTER', 'UNDO'}
    @classmethod
    def poll(cls, context):
        return (context.mode == 'POSE' and 
                context.object and context.object.type == 'ARMATURE' and
                context.selected_pose_bones and
                len(context.scene.animation_clips) > 0)
    def execute(self, context):
        scene = context.scene
        armature_obj = context.object
        selected_pbones = context.selected_pose_bones
        bone_names = [pbone.name for pbone in selected_pbones]
        frame_ranges = [(c.start_frame, c.end_frame) for c in scene.animation_clips]
        current_frame = scene.frame_current
        if frame_ranges:
            scene.frame_set(frame_ranges[0][0])
        offset = keyframe_utils.get_smart_offset(context, armature_obj)
        scene.frame_set(current_frame)
        if not offset:
            self.report({'ERROR'}, "无法计算智能偏移 (找不到骨架或子网格)")
            return {'CANCELLED'}
        count = keyframe_utils.apply_offset_to_bones(armature_obj, bone_names, offset, frame_ranges)
        self.report({'INFO'}, f"智能偏移 {offset.to_tuple(2)} 应用于 {len(frame_ranges)} 个片段, 移动了 {count} 个关键帧")
        return {'FINISHED'}
class ACTION_OT_preview_action(bpy.types.Operator):
    bl_idname = "action.preview_action"
    bl_label = "预览动作"
    action_name: bpy.props.StringProperty(name="动作名称", default="")
    @requires_license
    def execute(self, context):
        if not self.action_name:
            self.report({'ERROR'}, "未指定动作名称")
            return {'CANCELLED'}
        armature_obj = context.active_object
        if not armature_obj:
            self.report({'ERROR'}, "请先在3D视图中选择骨架对象")
            return {'CANCELLED'}
        if armature_obj.type != 'ARMATURE':
            if armature_obj.parent and armature_obj.parent.type == 'ARMATURE':
                armature_obj = armature_obj.parent
            else:
                self.report({'ERROR'}, "请选择一个骨架对象")
                return {'CANCELLED'}
        action = bpy.data.actions.get(self.action_name)
        if not action:
            self.report({'ERROR'}, f"找不到动作: {self.action_name}")
            return {'CANCELLED'}
        settings = context.scene.action_merge_settings
        current_action_playing = False
        for item in settings.action_items:
            if item.name == self.action_name and item.is_playing:
                current_action_playing = True
                break
        if current_action_playing:
            bpy.ops.screen.animation_cancel()
            if armature_obj.animation_data:
                armature_obj.animation_data.action = None
            for item in settings.action_items:
                item.is_playing = False
            self.report({'INFO'}, f"已停止播放: {self.action_name}")
            return {'FINISHED'}
        if context.screen.is_animation_playing:
            bpy.ops.screen.animation_cancel()
        for item in settings.action_items:
            item.is_playing = False
        for item in settings.action_items:
            if item.name == self.action_name:
                item.is_playing = True
                break
        try:
            if not armature_obj.animation_data:
                armature_obj.animation_data_create()
            armature_obj.animation_data.action = None
            if armature_obj.animation_data.nla_tracks:
                tracks_to_remove = list(armature_obj.animation_data.nla_tracks)
                for track in tracks_to_remove:
                    armature_obj.animation_data.nla_tracks.remove(track)
            current_frame = context.scene.frame_current
            context.scene.frame_set(0)
            armature_obj.rotation_euler = (0.0, 0.0, 0.0)
            context.scene.frame_set(current_frame)
            armature_obj.animation_data.action = action
            context.scene.frame_start = int(action.frame_range[0])
            context.scene.frame_end = int(action.frame_range[1])
            context.scene.frame_current = context.scene.frame_start
            bpy.ops.screen.animation_play()
            self.report({'INFO'}, f"正在预览: {self.action_name}")
        except Exception as e:
            self.report({'ERROR'}, f"播放失败: {str(e)}")
            for item in settings.action_items:
                item.is_playing = False
            return {'CANCELLED'}
        return {'FINISHED'}
class ACTION_OT_optimize_animation_curves(bpy.types.Operator):
    bl_idname = "action.optimize_animation_curves"
    bl_label = "1. 优化动画曲线"
    bl_options = {'REGISTER', 'UNDO'}
    threshold: bpy.props.FloatProperty(
        name="阈值", 
        description="判断关键帧是否多余的阈值 (值越小，清理越保守)",
        default=0.001
    )
    @requires_license
    def execute(self, context):
        actions = bpy.data.actions
        if not actions:
            self.report({'INFO'}, "没有找到任何动作 (Actions)")
            return {'FINISHED'}
        ctx_to_use = context
        dope_sheet_area = None
        if context.area.type == 'DOPESHEET_EDITOR':
            dope_sheet_area = context.area
        else:
            for area in context.screen.areas:
                if area.type == 'DOPESHEET_EDITOR' and area.ui_type == 'ACTION':
                    dope_sheet_area = area
                    break
            if not dope_sheet_area:
                for area in context.screen.areas:
                    if area.type == 'DOPESHEET_EDITOR':
                        dope_sheet_area = area
                        break
        if not dope_sheet_area:
            self.report({'ERROR'}, "未能找到 Dope Sheet (动作编辑器) 窗口。请在执行此操作前，确保界面上至少有一个'Dope Sheet'或'Action Editor'窗口可见。")
            return {'CANCELLED'}
        override = context.copy()
        override['area'] = dope_sheet_area
        override['region'] = dope_sheet_area.regions[0]
        ctx_to_use = override
        if not hasattr(bpy.ops.action, 'clean'):
             self.report({'ERROR'}, "操作符 'bpy.ops.action.clean' 未找到。您的Blender版本可能不支持此功能。")
             return {'CANCELLED'}
        cleaned_actions_count = 0
        original_action = None
        if dope_sheet_area.spaces.active:
             original_action = dope_sheet_area.spaces.active.action
        try:
            for action in actions:
                if not action.fcurves:
                    continue
                dope_sheet_area.spaces.active.action = action
                for fcurve in action.fcurves:
                    fcurve.select = True
                bpy.ops.action.clean(ctx_to_use, threshold=self.threshold, channels=False)
                for fcurve in action.fcurves:
                    fcurve.select = False
                cleaned_actions_count += 1
            self.report({'INFO'}, f"成功清理了 {cleaned_actions_count} 个动作的多余关键帧")
        except Exception as e:
            if "could not be found" in str(e).lower():
                self.report({'ERROR'}, f"清理关键帧时出错: 运算符 'bpy.ops.action.clean' 无法在 Dope Sheet 上下文中执行。请确保 Dope Sheet 编辑器可见。")
            else:
                self.report({'ERROR'}, f"清理关键帧时出错: {e}")
            return {'CANCELLED'}
        finally:
            if dope_sheet_area.spaces.active:
                dope_sheet_area.spaces.active.action = original_action
            for action in actions:
                for fcurve in action.fcurves:
                    fcurve.select = False
        return {'FINISHED'}
class ANIM_OT_lock_keyframes(bpy.types.Operator):
    bl_idname = "anim.lock_keyframes"
    bl_label = "锁定关键帧"
    bl_options = {'REGISTER', 'UNDO'}
    @classmethod
    def poll(cls, context):
        return (context.mode == 'POSE' and 
                context.object and context.object.type == 'ARMATURE' and
                context.selected_pose_bones)
    @requires_license
    def execute(self, context):
        scene = context.scene
        armature_obj = context.object
        selected_pbones = context.selected_pose_bones
        if not armature_obj.animation_data or not armature_obj.animation_data.action:
            self.report({'ERROR'}, "骨架上没有激活的 Action。")
            return {'CANCELLED'}
        action = armature_obj.animation_data.action
        settings = scene.keyframe_locker_settings
        start_frame = settings.lock_start_frame
        end_frame = settings.lock_end_frame
        axes_to_lock = [settings.lock_x_axis, settings.lock_y_axis, settings.lock_z_axis]
        if end_frame <= start_frame:
            self.report({'ERROR'}, "结束帧必须大于开始帧")
            return {'CANCELLED'}
        if not any(axes_to_lock):
            self.report({'INFO'}, "没有选择要锁定的轴 (X, Y, Z)")
            return {'FINISHED'}
        total_keys_inserted = 0
        num_frames = end_frame - start_frame + 1
        
        for pbone in selected_pbones:
            dp_loc = f'pose.bones["{pbone.name}"].location'
            fcurves_loc = [action.fcurves.find(dp_loc, index=i) for i in range(3)]
            start_values = [0.0, 0.0, 0.0]
            
            # Get or create fcurves and evaluate start values
            for i in range(3):
                if fcurves_loc[i]:
                    start_values[i] = fcurves_loc[i].evaluate(start_frame)
                else:
                    if axes_to_lock[i]:
                        fcurves_loc[i] = action.fcurves.new(data_path=dp_loc, index=i)
                        start_values[i] = 0.0
            
            # Bulk insert keyframes using foreach_set (much faster than insert loop)
            for i in range(3):
                if axes_to_lock[i] and fcurves_loc[i]:
                    fc = fcurves_loc[i]
                    # Pre-allocate keyframe points
                    fc.keyframe_points.add(num_frames)
                    # Build flat data arrays for bulk assignment
                    # co format: [frame0, value0, frame1, value1, ...]
                    co_data = []
                    for frame in range(start_frame, end_frame + 1):
                        co_data.extend([float(frame), start_values[i]])
                    fc.keyframe_points.foreach_set("co", co_data)
                    fc.update()
                    total_keys_inserted += num_frames
        
        self.report({'INFO'}, f"为 {len(selected_pbones)} 根骨骼锁定了 {total_keys_inserted} 个关键帧 (批量优化)")
        return {'FINISHED'}
class AnimationStabilizerSettings(bpy.types.PropertyGroup):
    iterations: bpy.props.IntProperty(name="迭代次数", default=2, min=1, max=50)
    window_size: bpy.props.IntProperty(name="窗口大小", default=10, min=1, max=100)
    sigma: bpy.props.FloatProperty(name="Sigma 强度", default=10.0, min=0.1, max=50.0)
    reduction_threshold: bpy.props.FloatProperty(name="简化阈值", default=0.01, min=0.0001, max=1.0)
class KeyframeCleanerSettings(bpy.types.PropertyGroup):
    clean_location: bpy.props.BoolProperty(name="位置", default=True)
    clean_rotation: bpy.props.BoolProperty(name="旋转", default=False)
    clean_scale: bpy.props.BoolProperty(name="缩放", default=False)
class KeyframeLockerSettings(bpy.types.PropertyGroup):
    lock_start_frame: bpy.props.IntProperty(name="开始帧", default=1, min=0)
    lock_end_frame: bpy.props.IntProperty(name="结束帧", default=10, min=0)
    lock_x_axis: bpy.props.BoolProperty(name="X轴", default=True)
    lock_y_axis: bpy.props.BoolProperty(name="Y轴", default=True)
    lock_z_axis: bpy.props.BoolProperty(name="Z轴", default=True)
class ActionMergeSettings(bpy.types.PropertyGroup):
    start_frame: bpy.props.IntProperty(name="起始帧", default=0, min=0) 
    start_offset: bpy.props.IntProperty(name="起始间隔", default=10, min=1) 
    frame_offset: bpy.props.IntProperty(name="动作间隔", default=50, min=1) 
    action_items: bpy.props.CollectionProperty(type=ActionItem) 
    clear_empty_objects: bpy.props.BoolProperty(name="清除空对象", default=False)
    enable_name_rules: bpy.props.BoolProperty(name="多骨架合并", default=False)  # 保留但不再使用
    use_original_name: bpy.props.BoolProperty(name="原始名称", default=False, description="勾选后合并动作时使用原始动作名称，不进行清理和映射")
    adaptive_scale: bpy.props.BoolProperty(name="适应缩放", default=False)
class AnimationClip(bpy.types.PropertyGroup):
    name: StringProperty(name="名称", default="未命名", update=lambda self, context: self.update_markers(context))
    start_frame: IntProperty(name="开始帧", default=0, update=lambda self, context: self.update_markers(context))
    end_frame: IntProperty(name="结束帧", default=0, update=lambda self, context: self.update_markers(context))
    def update_markers(self, context):
        scene = context.scene
        markers = scene.timeline_markers
        markers.clear()
        for clip in scene.animation_clips:
            markers.new(clip.name, frame=clip.start_frame)
            markers.new(clip.name, frame=clip.end_frame)
class ANIMATION_UL_list(UIList):
    use_filter_show = False
    use_filter_sort = False
    def draw_item(self, context, layout, data, item, icon, active_data, active_propname):
        if not item:
            return
        layout.label(text=f"{item.name} ({item.start_frame}-{item.end_frame})")
class ANIMATION_OT_refresh_list(bpy.types.Operator):
    bl_idname = "animation.refresh_list"
    bl_label = "刷新列表"
    def execute(self, context):
        update_animation_list(context)
        return {'FINISHED'}
def focus_timeline_on_range(context, start_frame, end_frame):
    frame_range = end_frame - start_frame
    if frame_range <= 0:
        frame_range = 1
    padding = frame_range * 0.15
    if padding < 5:
        padding = 5
    view_start = start_frame - padding
    view_end = end_frame + padding
    view_range_with_padding = view_end - view_start
    if view_range_with_padding <= 0:
        view_range_with_padding = 1
    for window in context.window_manager.windows:
        for area in window.screen.areas:
            if area.type in ('DOPESHEET_EDITOR', 'TIMELINE'):
                region = None
                for r in area.regions:
                    if r.type == 'WINDOW':
                        region = r
                        break
                if not region:
                    continue
                space = area.spaces.active
                if not hasattr(space, 'region_2d'):
                    continue
                space.region_2d.view_2d[0] = view_start
                region_width_pixels = region.width
                if region_width_pixels > 0 and view_range_with_padding > 0:
                    scale = region_width_pixels / view_range_with_padding
                    space.region_2d.view_2d_scale_x = scale
                area.tag_redraw()
class ANIMATION_OT_play_selected(bpy.types.Operator):
    bl_idname = "animation.play_selected"
    bl_label = "播放选定动画"
    def execute(self, context):
        bpy.ops.screen.animation_cancel()
        scene = context.scene
        anim_list = scene.animation_clips
        active_index = scene.animation_list_index
        if not (0 <= active_index < len(anim_list)):
            self.report({'ERROR'}, "没有选中的动画片段。")
            return {'CANCELLED'}
        clip = anim_list[active_index]
        scene.frame_start = clip.start_frame
        scene.frame_end = clip.end_frame
        scene.frame_current = clip.start_frame
        focus_timeline_on_range(context, clip.start_frame, clip.end_frame)
        bpy.ops.screen.animation_play()
        return {'FINISHED'}
class ANIMATION_OT_set_full_range(bpy.types.Operator):
    bl_idname = "animation.set_full_range"
    bl_label = "设置完整范围"
    def execute(self, context):
        scene = context.scene
        anim_list = scene.animation_clips
        if len(anim_list) > 0:
            first_clip = anim_list[0]
            last_clip = anim_list[-1]
            scene.frame_start = first_clip.start_frame
            scene.frame_end = last_clip.end_frame
            focus_timeline_on_range(context, first_clip.start_frame, last_clip.end_frame)
        return {'FINISHED'}
class ANIMATION_OT_ImportFromTxt(bpy.types.Operator):
    """从TXT或JSON文件导入动画片段"""
    bl_idname = "animation.import_from_txt"
    bl_label = "导入动画片段"
    filepath: bpy.props.StringProperty(name="文件路径", subtype='FILE_PATH')
    filename_ext = ".txt"
    filter_glob: bpy.props.StringProperty(default="*.txt;*.json", options={'HIDDEN'})
    
    def invoke(self, context, event):
        context.window_manager.fileselect_add(self)
        return {'RUNNING_MODAL'}
    
    def execute(self, context):
        file_path = self.filepath
        if not os.path.isfile(file_path):
            self.report({'ERROR'}, "文件路径无效！")
            return {'CANCELLED'}
        
        # 清空现有标记和片段
        context.scene.timeline_markers.clear()
        context.scene.animation_clips.clear()
        
        # 根据文件扩展名判断解析方式
        ext = os.path.splitext(file_path)[1].lower()
        
        if ext == '.json':
            count = self._import_from_json(context, file_path)
        else:
            count = self._import_from_txt(context, file_path)
        
        update_markers_from_clips(context)
        self.report({'INFO'}, f"导入成功！共导入 {count} 个动画片段")
        return {'FINISHED'}
    
    def _import_from_txt(self, context, file_path):
        """从TXT格式导入（CSV格式：Name,StartFrame,EndFrame）"""
        count = 0
        with open(file_path, 'r', encoding='utf-8') as file:
            lines = file.readlines()[1:]  # 跳过标题行
            for line in lines:
                parts = line.strip().split(',')
                if len(parts) == 3:
                    name, start_frame, end_frame = parts[0], int(parts[1]), int(parts[2])
                    if start_frame == -1 and end_frame == -1:
                        continue
                    # TXT格式需要+1修正
                    start_frame += 1
                    end_frame += 1
                    clip = context.scene.animation_clips.add()
                    clip.name = name
                    clip.start_frame = start_frame
                    clip.end_frame = end_frame
                    count += 1
        return count
    
    def _import_from_json(self, context, file_path):
        """从JSON格式导入（数组格式：[{name, start, end}, ...]）"""
        count = 0
        with open(file_path, 'r', encoding='utf-8') as file:
            data = json.load(file)
        
        if not isinstance(data, list):
            self.report({'ERROR'}, "JSON格式错误：期望数组格式")
            return 0
        
        for item in data:
            if not isinstance(item, dict):
                continue
            name = item.get('name', '')
            start_frame = item.get('start', 0)
            end_frame = item.get('end', 0)
            
            if not name:
                continue
            
            # JSON格式直接使用原始值，不做偏移
            clip = context.scene.animation_clips.add()
            clip.name = name
            clip.start_frame = int(start_frame)
            clip.end_frame = int(end_frame)
            count += 1
        
        return count
class ANIMATION_OT_ExportToTxt(bpy.types.Operator):
    bl_idname = "animation.export_to_txt"
    bl_label = "导出标记到TXT"
    filepath: bpy.props.StringProperty(name="文件路径", subtype='FILE_PATH')
    filename_ext = ".txt"
    filter_glob: bpy.props.StringProperty(default="*.txt", options={'HIDDEN'})
    frame_offset: bpy.props.IntProperty(name="偏移值", default=-1, soft_min=-1000, soft_max=1000)
    def invoke(self, context, event):
        self.filepath = "animation_info.txt"
        context.window_manager.fileselect_add(self)
        return {'RUNNING_MODAL'}
    def execute(self, context):
        export_path = self.filepath
        if not export_path.lower().endswith('.txt'):
            export_path += '.txt'
        anim_list = context.scene.animation_clips
        try:
            with open(export_path, 'w') as file:
                file.write("Name,StartFrame,EndFrame\n")
                for clip in anim_list:
                    start_frame = clip.start_frame + self.frame_offset
                    end_frame = clip.end_frame + self.frame_offset
                    if clip.name == "初始帧" and start_frame == -1 and end_frame == -1:
                        continue
                    if clip.name == "zSX2530075955":
                        start_frame = 0
                        end_frame = 1
                    file.write(f"{clip.name},{start_frame},{end_frame}\n")
            self.report({'INFO'}, f"标记已成功导出到: {export_path}，偏移值: {self.frame_offset}")
            return {'FINISHED'}
        except Exception as e:
            self.report({'ERROR'}, f"导出失败: {str(e)}")
            return {'CANCELLED'}
    def draw(self, context):
        layout = self.layout
        layout.separator()
        layout.label(text="帧偏移设置:")
        row = layout.row()
        row.prop(self, "frame_offset", text="偏移值")
def update_markers_from_clips(context):
    scene = context.scene
    markers = scene.timeline_markers
    markers.clear()
    for clip in scene.animation_clips:
        markers.new(clip.name, frame=clip.start_frame)
        markers.new(clip.name, frame=clip.end_frame)
def update_animation_list(context):
    scene = context.scene
    markers = scene.timeline_markers
    clips = scene.animation_clips
    clips.clear()
    marker_groups = {}
    for marker in markers:
        if marker.camera:
            continue
        if marker.name not in marker_groups:
            marker_groups[marker.name] = []
        marker_groups[marker.name].append(marker.frame)
    for name, frames in marker_groups.items():
        if len(frames) >= 2:
            frames.sort()
            start_frame = frames[0]
            end_frame = frames[1]
            new_clip = clips.add()
            new_clip.name = name
            new_clip.start_frame = start_frame
            new_clip.end_frame = end_frame
        else:
            print(f"警告：标记 '{name}' 只有一个，无法创建动画片段。")
    sort_animation_list(scene)
def sort_animation_list(scene):
    clips_list = []
    for clip in scene.animation_clips:
        clips_list.append({
            'name': clip.name,
            'start_frame': clip.start_frame,
            'end_frame': clip.end_frame
        })
    clips_list.sort(key=lambda x: x['start_frame'])
    scene.animation_clips.clear()
    for clip_data in clips_list:
        clip = scene.animation_clips.add()
        clip.name = clip_data['name']
        clip.start_frame = clip_data['start_frame']
        clip.end_frame = clip_data['end_frame']
class VIEW3D_OT_add_attachment_points(bpy.types.Operator):
    bl_idname = "view3d.add_attachment_points"
    bl_label = "添加附着点"
    @requires_license
    def execute(self, context):
        bone_patterns = {
            "Head": r".*Head.*",
            "chest": r".*Spine.*",
            "L Hand": r".*L Hand.*",
            "L Foot": r".*L Foot.*",
            "R Hand": r".*R Hand.*",
            "R Foot": r".*R Foot.*",
        }
        if bpy.context.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')
        try:
            active_collection = context.view_layer.active_layer_collection.collection
        except AttributeError:
            active_collection = context.scene.collection
        all_bones = []
        for obj in bpy.data.objects:
            if obj.type == 'ARMATURE':
                for bone in obj.pose.bones:
                    bone_head_world = obj.matrix_world @ bone.head
                    all_bones.append((obj, bone, bone_head_world))
        created_empties = []
        for obj, bone, bone_head_world in all_bones:
            for empty_base_name, pattern in bone_patterns.items():
                if re.search(pattern, bone.name, re.IGNORECASE):
                    empty_name = f"{empty_base_name} Ref"
                    if empty_name in bpy.data.objects:
                        continue
                    empty = bpy.data.objects.new(empty_name, None)
                    empty.empty_display_size = 0.1
                    empty.empty_display_type = 'PLAIN_AXES'
                    active_collection.objects.link(empty)
                    empty.location = bone_head_world
                    empty.parent = obj
                    empty.parent_type = 'BONE'
                    empty.parent_bone = bone.name
                    empty.location = (0, 0, 0)
                    created_empties.append(empty_name)
                    break
        overhead_name = "overhead Ref"
        if overhead_name not in bpy.data.objects:
            max_z = 0
            for obj in bpy.data.objects:
                if obj.type == 'MESH' and obj.visible_get():
                    world_bbox = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
                    for corner in world_bbox:
                        if corner.z > max_z:
                            max_z = corner.z
            if max_z > 0:
                overhead = bpy.data.objects.new(overhead_name, None)
                overhead.empty_display_size = 0.1
                overhead.empty_display_type = 'PLAIN_AXES'
                overhead.location = (0, 0, max_z)
                active_collection.objects.link(overhead)
                created_empties.append(overhead_name)
        origin_name = "origin Ref"
        if origin_name not in bpy.data.objects:
            origin = bpy.data.objects.new(origin_name, None)
            origin.empty_display_size = 0.1
            origin.empty_display_type = 'PLAIN_AXES'
            origin.location = (0, 0, 0)
            active_collection.objects.link(origin)
            created_empties.append(origin_name)
        if created_empties:
            bpy.ops.object.select_all(action='DESELECT')
            for empty_name in created_empties:
                if empty_name in bpy.data.objects:
                    bpy.data.objects[empty_name].select_set(True)
            self.report({'INFO'}, f"已创建 {len(created_empties)} 个附着点")
        else:
            self.report({'INFO'}, "未创建任何附着点")
        return {'FINISHED'}
class VIEW3D_OT_add_collision(bpy.types.Operator):
    bl_idname = "view3d.add_collision"
    bl_label = "添加碰撞体"
    @requires_license
    def execute(self, context):
        def find_target_bone():
            for obj in bpy.context.scene.objects:
                if obj.type == 'ARMATURE':
                    for bone in obj.data.bones:
                        if "spine" in bone.name.lower():
                            return obj, bone
            for obj in bpy.context.scene.objects:
                if obj.type == 'ARMATURE':
                    for bone in obj.data.bones:
                        if "pelvis" in bone.name.lower():
                            return obj, bone
            return None, None
        armature_obj, bone = find_target_bone()
        if bone:
            bone_matrix = armature_obj.matrix_world @ bone.matrix_local
            target_location = bone_matrix.to_translation()
            self.report({'INFO'}, f"找到骨骼 '{bone.name}'，将在其位置创建碰撞球")
        else:
            target_location = (0, 0, 0)
            self.report({'WARNING'}, "未找到符合条件的骨骼，将在原点创建碰撞球")
        current_active = context.view_layer.objects.active
        selected_objects = context.selected_objects.copy()
        bpy.ops.object.select_all(action='DESELECT')
        bpy.ops.object.create_collision_shape()
        collision_sphere = None
        for obj in context.scene.objects:
            if "CollisionSphere" in obj.name or "CollisionBox" in obj.name:
                collision_sphere = obj
                break
        if collision_sphere:
            collision_sphere.location = target_location
            collision_sphere["War3CollisionType"] = 'Sphere'
            collision_sphere.display_type = 'WIRE'
            collision_sphere.hide_render = True
            self.report({'INFO'}, f"碰撞球已创建并移动到位置: {target_location}")
        else:
            self.report({'ERROR'}, "未能找到创建的碰撞球")
        for obj in selected_objects:
            obj.select_set(True)
        context.view_layer.objects.active = current_active
        return {'FINISHED'}
class VIEW3D_OT_add_camera(bpy.types.Operator):
    bl_idname = "view3d.add_camera"
    bl_label = "一键添加辅助体"
    @requires_license 
    def execute(self, context):
        create_front_view_camera()
        bpy.ops.view3d.add_collision()
        bpy.ops.view3d.add_attachment_points()
        self.report({'INFO'}, "已创建摄像机和碰撞体还有附着点")
        return {'FINISHED'}
class MATERIAL_OT_split_by_material(bpy.types.Operator):
    bl_idname = "material.split_by_material"
    bl_label = "材质分离网格"
    bl_options = {'REGISTER', 'UNDO'}
    @classmethod
    def poll(cls, context):
        return (context.active_object is not None and 
                context.active_object.type == 'MESH' and 
                len(context.active_object.data.materials) > 0)
    def create_unique_material(self, original_mat, new_name):
        if not original_mat:
            return None
        new_mat = original_mat.copy()
        new_mat.name = new_name
        return new_mat
    def clean_up_material_slots(self, mesh):
        if not mesh.materials:
            return
        used_material_indices = set()
        bm = bmesh.new()
        bm.from_mesh(mesh)
        for face in bm.faces:
            if face.material_index < len(mesh.materials):
                used_material_indices.add(face.material_index)
        bm.free()
        if not used_material_indices:
            mesh.materials.clear()
            return
        if len(used_material_indices) == 1:
            used_index = next(iter(used_material_indices))
            used_material = mesh.materials[used_index]
            mesh.materials.clear()
            mesh.materials.append(used_material)
    @requires_license
    def execute(self, context):
        original_obj = context.active_object
        original_mesh = original_obj.data
        if context.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')
        bpy.ops.object.select_all(action='DESELECT')
        original_obj.select_set(True)
        context.view_layer.objects.active = original_obj
        materials = original_mesh.materials
        if not materials:
            self.report({'ERROR'}, "对象没有材质")
            return {'CANCELLED'}
        created_objects = []
        for mat_index, material in enumerate(materials):
            if not material:
                continue
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.mesh.select_all(action='DESELECT')
            bpy.ops.mesh.select_mode(type='FACE')
            bpy.ops.object.mode_set(mode='OBJECT')
            bm = bmesh.new()
            bm.from_mesh(original_mesh)
            bm.faces.ensure_lookup_table()
            faces_selected = False
            for face in bm.faces:
                if face.material_index == mat_index:
                    face.select = True
                    faces_selected = True
                else:
                    face.select = False
            if not faces_selected:
                bm.free()
                continue
            bm.to_mesh(original_mesh)
            bm.free()
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.separate(type='SELECTED')
            bpy.ops.object.mode_set(mode='OBJECT')
            separated_objects = context.selected_objects
            new_obj = None
            for obj in separated_objects:
                if obj != original_obj:
                    new_obj = obj
                    break
            if new_obj:
                self.clean_up_material_slots(new_obj.data)
                if new_obj.data.materials:
                    original_mat = new_obj.data.materials[0]
                    new_mat_name = f"Material_{original_mat.name}_{len(created_objects)}"
                    new_mat = self.create_unique_material(original_mat, new_mat_name)
                    if new_mat:
                        new_obj.data.materials[0] = new_mat
                    new_obj_name = f"Separated_{original_mat.name}"
                    new_obj.name = new_obj_name
                    new_obj.data.name = new_obj_name
                    new_mat.name = f"{new_obj_name}_Material"
                    created_objects.append(new_obj)
            bpy.ops.object.select_all(action='DESELECT')
            original_obj.select_set(True)
            context.view_layer.objects.active = original_obj
        original_mesh_data = original_obj.data
        bpy.data.objects.remove(original_obj, do_unlink=True)
        if original_mesh_data.users == 0:
            bpy.data.meshes.remove(original_mesh_data)
        bpy.ops.object.select_all(action='DESELECT')
        for obj in created_objects:
            obj.select_set(True)
        if created_objects:
            context.view_layer.objects.active = created_objects[0]
            self.report({'INFO'}, f"成功分离并创建了 {len(created_objects)} 个独立对象")
        else:
            self.report({'WARNING'}, "没有成功分离出任何对象")
        return {'FINISHED'}
class BLENDERANIM_MT_preferences(bpy.types.AddonPreferences):
    bl_idname = "blenderanimMDL"
    check_for_updates: bpy.props.BoolProperty(name="检查更新", default=False)
    last_update_check: bpy.props.StringProperty(name="最后检查时间", default="从未检查")
    def draw(self, context):
        layout = self.layout
        wm = context.window_manager
        box = layout.box()
        box.label(text="插件更新", icon='FILE_REFRESH')
        row = box.row()
        row.label(text=f"当前版本: {UpdateConfig.get_version_string()}")
        row = box.row()
        row.operator("addon.check_for_updates", icon='FILE_REFRESH', text="检查更新")
        if hasattr(wm, 'addon_last_update_check_time'):
            last_check = wm.addon_last_update_check_time 
            if last_check != "从未检查":
                row = box.row()
                row.label(text=f"最后检查: {last_check}")
        if hasattr(wm, 'addon_update_available') and wm.addon_update_available: 
            update_box = box.box()
            update_box.alert = True
            update_box.label(text=f"新版本 {wm.addon_new_version} 可用!", icon='ERROR') 
            if hasattr(wm, 'addon_update_changelog') and wm.addon_update_changelog: 
                changelog_box = update_box.box()
                changelog_box.label(text="更新内容:")
                for line in wm.addon_update_changelog.split('\n'): 
                    if line.strip():
                        changelog_box.label(text=f"• {line.strip()}")
            row = update_box.row()
            row.operator("addon.show_update_dialog", text="立即更新", icon='IMPORT')
        box.separator()
        row = box.row()
        row.operator("wm.url_open", text="访问Gitee页面", icon='URL').url = f"https://gitee.com/amisd666/BlenderAnimMDL"
class VIEW3D_PT_merge_actions(bpy.types.Panel):
    bl_label = "动画合并工具"
    bl_idname = "VIEW3D_PT_merge_actions"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "动画合并"
    def draw(self, context):
        layout = self.layout
        wm = context.window_manager
        settings = context.scene.action_merge_settings
        scene = context.scene
        valid, message, expiry_date = validate_license_embedded()
        if not valid:
            row = layout.row()
            row.operator("license.copy_machine_code", icon='COPYDOWN')
            box = layout.box()
            box.label(text="许可证状态: 未激活", icon='ERROR')
            box.label(text="请联系作者QQ2530075955")
            box.label(text="提供机器码以获取免费试用许可证")
        else:
            row = layout.row() 
            toggle_text = "隐藏合并设置" if scene.show_merge_settings else "合并设置" 
            row.operator("wm.toggle_merge_settings", text=toggle_text, icon='SETTINGS') 
            if scene.show_merge_settings:
                box = layout.box() 
                row = box.row()
                row.prop(settings, "start_frame")
                row.prop(scene, "frame_end", text="当前结束帧")
                row = box.row()
                row.prop(settings, "start_offset")
                row.prop(settings, "frame_offset")
                row = box.row()
                row.prop(settings, "clear_empty_objects", text="清除空对象")
                row.prop(settings, "adaptive_scale", text="适应缩放")
                row = box.row()
                row.prop(scene, "convert_blp_textures", text="转换BLP贴图")
                row = box.row()
                row.prop(scene, "mdl_export_optimize_animation")
                row = box.row()
                row.prop(scene, "mdl_export_optimize_tolerance")

            row = layout.row()
            row.operator("view3d.import_fbx", text="导入FBX", icon='IMPORT')
            row.operator("view3d.batch_import_fbx", text="多FBX合并", icon='IMPORT')
            layout.operator("export_scene.simple_fbx", text="合并导出FBX", icon='IMPORT')
            layout.operator("material.auto_texture", text="一键上贴图", icon='TEXTURE')
            row = layout.row()
            toggle_tools_text = "隐藏关键帧工具" if scene.show_keyframe_tools else "关键帧工具"
            row.operator("wm.toggle_keyframe_tools", text=toggle_tools_text, icon='TOOL_SETTINGS')
            if scene.show_keyframe_tools:
                tools_box = layout.box()
                tools_box.label(text="关键帧和骨骼工具", icon='BONE_DATA')
                row = tools_box.row()
                row.scale_y = 1.2
                row.prop(scene, "use_world_space_tools", icon='WORLD', toggle=True)
                tools_box.separator()
                opt_box = tools_box.box()
                opt_box.label(text="模型优化", icon='OUTLINER_OB_LIGHTPROBE')
                opt_box.operator("action.optimize_animation_curves", text="优化动画曲线")
                tools_box.separator()
                aligner_box = tools_box.box()
                aligner_box.label(text="骨骼对齐", icon='CONSTRAINT_BONE')
                armature_obj = context.active_object
                is_armature = armature_obj and armature_obj.type == 'ARMATURE'
                is_pose_mode = context.mode == 'POSE'
                has_selected_bones = is_pose_mode and context.selected_pose_bones
                if not is_armature or not has_selected_bones:
                    aligner_box.label(text="请在姿态模式下选择骨骼", icon='INFO')
                else:
                    align_settings = scene.bone_align_settings 
                    row = aligner_box.row(align=True) 
                    row.prop(align_settings, "start_frame", text="开始")
                    row.prop(align_settings, "end_frame", text="结束")
                    row = aligner_box.row(align=True) 
                    row.operator("anim.align_bone_transforms", text="对齐位置").align_mode = 'LOCATION'
                    row.operator("anim.align_bone_transforms", text="对齐旋转").align_mode = 'ROTATION'
                    row = aligner_box.row(align=True) 
                    row.operator("anim.align_bone_transforms", text="对齐缩放").align_mode = 'SCALE'
                    row.operator("anim.align_bone_transforms", text="对齐全部").align_mode = 'ALL'
                tools_box.separator()
                origin_box = tools_box.box()
                origin_box.label(text="位移归零", icon='SNAP_GRID')
                if not is_armature or not has_selected_bones:
                    origin_box.label(text="请在姿态模式下选择骨骼", icon='INFO')
                else:
                    row = origin_box.row(align=True)
                    row.operator("anim.align_bone_to_origin", text="归零当前片段")
                    row.operator("anim.align_all_bones_to_origin", text="归零所有片段")
                    row = origin_box.row(align=True)
                    row.prop(scene, "keep_x_axis", text="保持X轴")
                    row.prop(scene, "keep_y_axis", text="保持Y轴")
                    row.prop(scene, "keep_z_axis", text="保持Z轴")
                tools_box.separator()
                cleaner_box = tools_box.box()
                cleaner_box.label(text="关键帧清理", icon='X')
                if not is_armature or not has_selected_bones:
                    cleaner_box.label(text="请在姿态模式下选择骨骼", icon='INFO')
                else:
                    cleaner_settings = scene.keyframe_cleaner_settings
                    row = cleaner_box.row(align=True)
                    row.prop(cleaner_settings, "clean_location")
                    row.prop(cleaner_settings, "clean_rotation")
                    row.prop(cleaner_settings, "clean_scale")
                    row = cleaner_box.row(align=True)
                    row.operator("anim.clean_keyframe_current", text="清理当前片段", icon='REMOVE')
                    row.operator("anim.clean_keyframe_all", text="清理所有片段", icon='REMOVE')
                tools_box.separator()
                locker_box = tools_box.box()
                locker_box.label(text="关键帧锁定", icon='LOCKED')
                if not is_armature or not has_selected_bones:
                    locker_box.label(text="请在姿态模式下选择骨骼", icon='INFO')
                else:
                    locker_settings = scene.keyframe_locker_settings
                    row = locker_box.row(align=True)
                    row.prop(locker_settings, "lock_start_frame", text="开始")
                    row.prop(locker_settings, "lock_end_frame", text="结束")
                    row = locker_box.row(align=True)
                    row.prop(locker_settings, "lock_x_axis")
                    row.prop(locker_settings, "lock_y_axis")
                    row.prop(locker_settings, "lock_z_axis")
                    row = locker_box.row()
                    row.operator("anim.lock_keyframes", text="锁定", icon='CONSTRAINT')
                tools_box.separator()
                mover_box = tools_box.box()
                mover_box.label(text="关键帧移动", icon='PIVOT_CURSOR')
                if not is_armature or not has_selected_bones:
                    mover_box.label(text="请在姿态模式下选择骨骼", icon='INFO')
                else:
                    row = mover_box.row(align=True)
                    row.prop(scene, "keyframe_move_offset_x")
                    row.prop(scene, "keyframe_move_offset_y")
                    row.prop(scene, "keyframe_move_offset_z")
                    row = mover_box.row(align=True)
                    row.operator("anim.keyframe_move_normal", text="片段移动")
                    row.operator("anim.keyframe_move_normal_all", text="全部移动")
                    
                    # New Rotation UI
                    layout.separator()
                    row = mover_box.row(align=True)
                    row.label(text="批量旋转 (度):")
                    row = mover_box.row(align=True)
                    row.prop(scene, "keyframe_rotate_offset_x")
                    row.prop(scene, "keyframe_rotate_offset_y")
                    row.prop(scene, "keyframe_rotate_offset_z")
                    row = mover_box.row(align=True)
                    row.operator("anim.keyframe_rotate_normal", text="片段旋转")
                    row.operator("anim.keyframe_rotate_normal_all", text="全部旋转")
                tools_box.separator()
                stab_box = tools_box.box()
                stab_box.label(text="动画平滑", icon='MOD_SMOOTH')
                if not is_armature or not has_selected_bones:
                    stab_box.label(text="请在姿态模式下选择骨骼", icon='INFO')
                else:
                    stab_settings = scene.animation_stabilizer_settings
                    row1 = stab_box.row(align=True)
                    row1.prop(stab_settings, "iterations")
                    row1.prop(stab_settings, "window_size")
                    row2 = stab_box.row(align=True)
                    row2.prop(stab_settings, "sigma")
                    row2.prop(stab_settings, "reduction_threshold")
                    row_buttons = stab_box.row(align=True)
                    row_buttons.operator("anim.stabilize_animation", text="平滑当前")
                    row_buttons.operator("anim.stabilize_animation_all_clips", text="平滑所有")
            layout.operator("action.refresh_actions", icon='FILE_REFRESH')
            row = layout.row(align=True)
            icon = 'TRIA_DOWN' if scene.show_action_list else 'TRIA_RIGHT'
            row.prop(scene, "show_action_list", text="动作列表", icon=icon, toggle=True)
            row.prop(settings, "use_original_name", text="原始名称")
            if scene.show_action_list:
                row = layout.row(align=True)
                row.operator("action.select_all_actions", text="全选").select = True
                row.operator("action.select_all_actions", text="取消全选").select = False
                if settings.action_items:
                    action_box = layout.box()
                    for item in settings.action_items:
                        row = action_box.row()
                        row.prop(item, "use", text="")
                        row.label(text=item.name, icon='ACTION')
                        if item.is_playing:
                            op = row.operator("action.preview_action", text="停止", icon='SNAP_FACE')
                            op.action_name = item.name
                        else:
                            op = row.operator("action.preview_action", text="播放", icon='PLAY')
                            op.action_name = item.name
                else:
                    layout.label(text="没有可用的动作", icon='ERROR')
            layout.operator("action.merge", text="合并动作", icon='KEYTYPE_EXTREME_VEC')
            row = layout.row()
            toggle_text = "隐藏动画管理器" if scene.show_animation_manager else "动画管理器"
            row.operator("wm.toggle_animation_manager", text=toggle_text, icon='SEQUENCE_COLOR_04')
            if scene.show_animation_manager:
                box = layout.box()
                box.label(text="动画管理器", icon='ACTION')
                row = box.row()
                row.template_list("ANIMATION_UL_list", "Animation List", 
                                 scene, "animation_clips", 
                                 scene, "animation_list_index")
                row = box.row(align=True)
                row.operator("animation.play_selected", text="播放动画", icon='PLAY')
                row.operator("animation.refresh_list", text="刷新列表")
                if scene.animation_list_index >= 0 and len(scene.animation_clips) > 0:
                        clip = scene.animation_clips[scene.animation_list_index]
                        detail_box = box.box()
                        detail_box.label(text="动画详情:")
                        row = detail_box.row()
                        row.label(text="名称:")
                        row.prop(clip, "name", text="")
                        row = detail_box.row()
                        row.label(text="开始帧:")
                        row.prop(clip, "start_frame", text="")
                        row = detail_box.row()
                        row.label(text="结束帧:")
                        row.prop(clip, "end_frame", text="")
                box.operator("animation.set_full_range", text="查看完整动画范围")
                import_export_box = box.box()
                import_export_box.label(text="导入导出:")
                row = import_export_box.row()
                row.operator("animation.import_from_txt", text="导入")
                row.operator("animation.export_to_txt", text="导出")
            row = layout.row()
            toggle_outline_text = "隐藏描边设置" if scene.show_outline_settings else "描边设置"
            row.operator("wm.toggle_outline_settings", text=toggle_outline_text, icon='LINE_DATA')
            if scene.show_outline_settings:
                box = layout.box()
                box.label(text="描边设置", icon='LINE_DATA')
                box.prop(scene, "oh_outline_thickness", text="厚度")
                box.prop(scene, "oh_apply_scale", text="应用缩放")
                box.prop(scene, "oh_outline_color", text="颜色")
                row = box.row()
                row.operator("object.oh_add_outline", icon="ADD", text="添加/设置轮廓")
                row = box.row()
                row.operator("object.oh_remove", icon="PANEL_CLOSE", text="移除轮廓")
            layout.operator("view3d.add_camera", text="智能添加辅助体", icon='CAMERA_DATA')
            layout.operator("material.split_by_material", text="材质分离网格", icon='MOD_ARRAY')
            layout.operator("view3d.export_mdl", text="导出MDL", icon='COLLECTION_COLOR_02')
            layout.operator("action.clean_anim_data", text="清理动画数据", icon='TRASH')
            layout.operator("action.convert_to_mdl", text="一键转换mdl", icon='IMPORT')
            box = layout.box()
            box.label(text="许可证状态: 已激活", icon='CHECKMARK')
            box.label(text=f"到期时间: {expiry_date}")
        box = layout.box()
        box.label(text="作者QQ2530075955", icon='INFO')
class wm_OT_toggle_keyframe_tools(bpy.types.Operator):
    bl_idname = "wm.toggle_keyframe_tools"
    bl_label = "切换关键帧工具"
    def execute(self, context):
        context.scene.show_keyframe_tools = not context.scene.show_keyframe_tools
        return {'FINISHED'}
class wm_OT_toggle_animation_manager(bpy.types.Operator):
    bl_idname = "wm.toggle_animation_manager"
    bl_label = "切换动画管理器"
    def execute(self, context):
        context.scene.show_animation_manager = not context.scene.show_animation_manager
        return {'FINISHED'}
class wm_OT_toggle_outline_settings(bpy.types.Operator):
    bl_idname = "wm.toggle_outline_settings"
    bl_label = "切换描边设置"
    def execute(self, context):
        context.scene.show_outline_settings = not context.scene.show_outline_settings
        return {'FINISHED'} 
class wm_OT_toggle_keyframe_mover(bpy.types.Operator):
    bl_idname = "wm.toggle_keyframe_mover"
    bl_label = "切换关键帧移动"
    def execute(self, context):
        context.scene.show_keyframe_mover = not context.scene.show_keyframe_mover
        return {'FINISHED'}
class wm_OT_toggle_animation_stabilizer(bpy.types.Operator):
    bl_idname = "wm.toggle_animation_stabilizer"
    bl_label = "切换动画平滑"
    def execute(self, context):
        context.scene.show_animation_stabilizer = not context.scene.show_animation_stabilizer
        return {'FINISHED'}
class wm_OT_toggle_merge_settings(bpy.types.Operator):
    bl_idname = "wm.toggle_merge_settings"
    bl_label = "切换合并设置"
    def execute(self, context):
        context.scene.show_merge_settings = not context.scene.show_merge_settings
        return {'FINISHED'}
class wm_OT_toggle_optimization_tools(bpy.types.Operator):
    bl_idname = "wm.toggle_optimization_tools"
    bl_label = "切换优化工具"
    def execute(self, context):
        context.scene.show_optimization_tools = not context.scene.show_optimization_tools
        return {'FINISHED'}
class wm_OT_toggle_bone_aligner(bpy.types.Operator):
    bl_idname = "wm.toggle_bone_aligner"
    bl_label = "切换骨骼对齐"
    def execute(self, context):
        context.scene.show_bone_aligner = not context.scene.show_bone_aligner
        return {'FINISHED'}
class wm_OT_toggle_keyframe_cleaner(bpy.types.Operator):
    bl_idname = "wm.toggle_keyframe_cleaner"
    bl_label = "切换关键帧清理"
    def execute(self, context):
        context.scene.show_keyframe_cleaner = not context.scene.show_keyframe_cleaner
        return {'FINISHED'}
class wm_OT_toggle_keyframe_locker(bpy.types.Operator):
    bl_idname = "wm.toggle_keyframe_locker"
    bl_label = "切换关键帧锁定"
    def execute(self, context):
        context.scene.show_keyframe_locker = not context.scene.show_keyframe_locker
        return {'FINISHED'}
class ANIM_OT_stabilize_animation(bpy.types.Operator):
    bl_idname = "anim.stabilize_animation"
    bl_label = "动画平滑 (当前片段)"
    bl_options = {'REGISTER', 'UNDO'}
    @classmethod
    def poll(cls, context):
        return (context.object and context.object.type == 'ARMATURE' and
                len(context.scene.animation_clips) > 0 and
                context.scene.animation_list_index >= 0)
    def execute(self, context):
        scene = context.scene
        armature_obj = context.object
        settings = scene.animation_stabilizer_settings
        if not armature_obj.pose:
             self.report({'ERROR'}, "无法访问骨架的姿态。")
             return {'CANCELLED'}
        bone_names = [pbone.name for pbone in armature_obj.pose.bones]
        clip = scene.animation_clips[scene.animation_list_index]
        start_frame = clip.start_frame
        end_frame = clip.end_frame
        if (end_frame - start_frame) < 2:
            self.report({'ERROR'}, f"动画片段 '{clip.name}' 太短 (小于2帧)，无法处理。")
            return {'CANCELLED'}
        if not armature_obj.animation_data or not armature_obj.animation_data.action:
            self.report({'ERROR'}, "骨架上没有激活的 Action。")
            return {'CANCELLED'}
        action = armature_obj.animation_data.action
        count, message = animation_smoother.smooth_and_reduce_bones(
            armature_obj, 
            bone_names, 
            start_frame, 
            end_frame, 
            settings
        )
        if count > 0:
            self.report({'INFO'}, f"稳定完成: 对 {len(bone_names)} 根骨骼, {message}")
        else:
            self.report({'WARNING'}, f"稳定未执行: {message}")
        return {'FINISHED'}
class ANIM_OT_stabilize_animation_all_clips(bpy.types.Operator):
    bl_idname = "anim.stabilize_animation_all_clips"
    bl_label = "动画平滑 (所有片段)"
    bl_options = {'REGISTER', 'UNDO'}
    @classmethod
    def poll(cls, context):
        return (context.object and context.object.type == 'ARMATURE' and
                len(context.scene.animation_clips) > 0)
    def execute(self, context):
        scene = context.scene
        armature_obj = context.object
        settings = scene.animation_stabilizer_settings
        if not armature_obj.pose:
             self.report({'ERROR'}, "无法访问骨架的姿态。")
             return {'CANCELLED'}
        bone_names = [pbone.name for pbone in armature_obj.pose.bones]
        if not armature_obj.animation_data or not armature_obj.animation_data.action:
            self.report({'ERROR'}, "骨架上没有激活的 Action。")
            return {'CANCELLED'}
        action = armature_obj.animation_data.action
        processed_clips = 0
        total_curves_smoothed = 0
        total_curves_closed = 0
        for clip in scene.animation_clips:
            start_frame = clip.start_frame
            end_frame = clip.end_frame
            if (end_frame - start_frame) < 2:
                continue
            count, message = animation_smoother.smooth_and_reduce_bones(
                armature_obj, 
                bone_names, 
                start_frame, 
                end_frame, 
                settings
            )
            if count > 0:
                processed_clips += 1
                total_curves_smoothed += count
        if processed_clips > 0:
            self.report({'INFO'}, f"稳定完成: 共处理了 {processed_clips} 个片段，平滑了 {total_curves_smoothed} 条曲线。")
        else:
            self.report({'WARNING'}, "稳定未执行: 找不到有效片段或关键帧。")
        return {'FINISHED'}
def create_front_view_camera():
    for obj in bpy.data.objects:
        if obj.type == 'CAMERA':
            bpy.data.objects.remove(obj, do_unlink=True)
    try:
        active_collection = bpy.context.view_layer.active_layer_collection.collection
    except AttributeError:
        active_collection = bpy.context.scene.collection
    selected_objects = [obj for obj in bpy.context.selected_objects if obj.type == 'MESH']
    if not selected_objects:
        selected_objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    if not selected_objects:
        camera_data = bpy.data.cameras.new("Camera")
        camera_object = bpy.data.objects.new("Camera", camera_data)
        active_collection.objects.link(camera_object)
        bpy.context.scene.camera = camera_object
        return
    min_coord = Vector((float('inf'), float('inf'), float('inf')))
    max_coord = Vector((float('-inf'), float('-inf'), float('-inf')))
    for obj in selected_objects:
        bbox_corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
        for corner in bbox_corners:
            min_coord.x = min(min_coord.x, corner.x)
            min_coord.y = min(min_coord.y, corner.y)
            min_coord.z = min(min_coord.z, corner.z)
            max_coord.x = max(max_coord.x, corner.x)
            max_coord.y = max(max_coord.y, corner.y)
            max_coord.z = max(max_coord.z, corner.z)
    center = (min_coord + max_coord) / 2
    size = max_coord - min_coord
    max_dim = max(size.x, size.y, size.z)
    camera_data = bpy.data.cameras.new("Camera01")
    camera_object = bpy.data.objects.new("Camera01", camera_data)
    active_collection.objects.link(camera_object)
    fov_angle = math.radians(40)
    distance = (max_dim / 2) / math.tan(fov_angle / 2)
    distance *= 0.7
    camera_location = Vector((0, center.y - distance, center.z + distance * 0.4))
    camera_object.location = camera_location
    target_location = Vector((0, center.y, center.z * 1.45))
    direction = target_location - camera_location
    rot_quat = direction.to_track_quat('-Z', 'Y')
    camera_object.rotation_euler = rot_quat.to_euler()
    bpy.context.scene.camera = camera_object
    camera_data.lens = 50
    camera_data.clip_end = distance * 100
@bpy.app.handlers.persistent
def on_animation_stop(scene):
    pass

def update_tool_frames_from_anim_list(self, context):
    try:
        scene = context.scene
        active_index = scene.animation_list_index
        clips = scene.animation_clips
        if active_index >= 0 and active_index < len(clips):
            selected_clip = clips[active_index]
            if hasattr(scene, 'bone_align_settings'):
                align_settings = scene.bone_align_settings
                align_settings.start_frame = selected_clip.start_frame
                align_settings.end_frame = selected_clip.end_frame
            if hasattr(scene, 'keyframe_locker_settings'):
                locker_settings = scene.keyframe_locker_settings
                locker_settings.lock_start_frame = selected_clip.start_frame
                locker_settings.lock_end_frame = selected_clip.end_frame
    except Exception as e:
        print(f"Error updating tool frames from anim list: {e}")
def register():
    property_group_classes = [
        AnimationClip,
        ActionItem,
        ActionMergeSettings,
        AnimationStabilizerSettings,
        BoneAlignSettings,
        KeyframeCleanerSettings,
        KeyframeLockerSettings,
    ]
    update_classes = [
        UPDATE_OT_check_for_updates,
        UPDATE_OT_show_update_dialog, 
        UPDATE_OT_perform_update,
        UPDATE_OT_show_restart_dialog
    ]
    other_classes = [
        ANIMATION_UL_list,
        ANIMATION_OT_refresh_list,
        ANIMATION_OT_play_selected,
        ANIMATION_OT_set_full_range,
        ANIMATION_OT_ImportFromTxt,
        ANIMATION_OT_ExportToTxt,
        wm_OT_toggle_animation_manager,
        VIEW3D_OT_add_attachment_points,
        OH_OT_Add_Outline_Operator,
        OH_OT_Remove_Operator,
        wm_OT_toggle_outline_settings,
        wm_OT_toggle_keyframe_mover,
        wm_OT_toggle_animation_stabilizer,
        wm_OT_toggle_merge_settings,
        wm_OT_toggle_optimization_tools,
        wm_OT_toggle_bone_aligner,
        ANIM_OT_stabilize_animation,
        ANIM_OT_stabilize_animation_all_clips,
        ANIM_OT_keyframe_move_normal,
        ANIM_OT_keyframe_move_normal_all,
        ANIM_OT_keyframe_rotate_normal,
        ANIM_OT_keyframe_rotate_normal_all,
        ANIM_OT_keyframe_move_smart,
        ANIM_OT_keyframe_move_smart_all,
        LICENSE_OT_copy_machine_code,
        ACTION_OT_refresh_actions,
        ACTION_OT_clean_anim_data,
        ANIM_OT_align_bone_to_origin,
        ANIM_OT_align_all_bones_to_origin,
        ACTION_OT_merge,
        ACTION_OT_select_all_actions,
        VIEW3D_PT_merge_actions,
        ACTION_OT_convert_to_mdl,
        VIEW3D_OT_import_fbx,
        VIEW3D_OT_batch_import_fbx,
        VIEW3D_OT_export_mdl,
        VIEW3D_OT_add_camera,
        VIEW3D_OT_add_collision,
        WAR3_OT_add_mdl_layer_to_all_materials,
        MATERIAL_OT_split_by_material,
        ACTION_OT_preview_action,
        INTERNAL_OT_convert_blp_textures,
        SimpleFBXExport,
        BLENDERANIM_MT_preferences,
        ACTION_OT_optimize_animation_curves,
        wm_OT_toggle_keyframe_cleaner,
        wm_OT_toggle_keyframe_locker,
        ANIM_OT_lock_keyframes,
        wm_OT_toggle_keyframe_tools,
    ]
    for cls in property_group_classes:
        try:
            bpy.utils.register_class(cls)
        except Exception: 
            pass
    try:
        bpy.utils.register_class(BoneAlignSettings)
    except Exception:
        pass
    classes_to_register = other_classes + update_classes
    for cls in classes_to_register:
        try:
            bpy.utils.register_class(cls)
        except Exception: 
            pass
    try:
        bpy.types.WindowManager.addon_update_available = bpy.props.BoolProperty(name="Update Available", default=False)
        bpy.types.WindowManager.addon_update_download_url = bpy.props.StringProperty(name="Update Download URL", default="")
        bpy.types.WindowManager.addon_new_version = bpy.props.StringProperty(name="New Version", default="")
        bpy.types.WindowManager.addon_current_version = bpy.props.StringProperty(name="Current Version", default="")
        bpy.types.WindowManager.addon_last_update_check_time = bpy.props.StringProperty(name="Last Update Check Time", default="从未检查")
        bpy.types.WindowManager.addon_update_changelog = bpy.props.StringProperty(name="Update Changelog", default="")
        bpy.types.Scene.show_merge_settings = bpy.props.BoolProperty(name="显示合并设置", default=False)
        bpy.types.Scene.show_optimization_tools = bpy.props.BoolProperty(name="显示优化工具", default=False)
        bpy.types.Scene.show_bone_aligner = bpy.props.BoolProperty(name="显示骨骼对齐", default=False)
        bpy.types.Scene.show_keyframe_tools = bpy.props.BoolProperty(name="显示关键帧工具", default=False)
        bpy.types.Scene.use_world_space_tools = bpy.props.BoolProperty(name="使用世界/模型坐标", default=True)
    except Exception as e:
        print(f"Warn: 无法注册 WindowManager 属性: {e}")
    try:
        bpy.types.Scene.animation_clips = bpy.props.CollectionProperty(type=AnimationClip)
        bpy.types.Scene.animation_list_index = bpy.props.IntProperty(
        default=0,
        update=update_tool_frames_from_anim_list
        )
        bpy.types.Scene.show_animation_manager = bpy.props.BoolProperty(default=False)
        bpy.types.Scene.keep_x_axis = bpy.props.BoolProperty(name="保持X轴", default=False)
        bpy.types.Scene.keep_y_axis = bpy.props.BoolProperty(name="保持Y轴", default=False)
        bpy.types.Scene.keep_z_axis = bpy.props.BoolProperty(name="保持Z轴", default=True)
        bpy.types.Scene.show_outline_settings = bpy.props.BoolProperty(name="显示描边设置", default=False)
        bpy.types.Scene.oh_outline_thickness = bpy.props.FloatProperty(name="轮廓厚度", default=0.005, min=0, max=1000000, precision=3)
        bpy.types.Scene.oh_apply_scale = bpy.props.BoolProperty(name="应用缩放", default=True)
        bpy.types.Scene.oh_outline_color = bpy.props.EnumProperty(name="轮廓颜色", items=COLOR_PATHS, default="Textures\\Black32")
        bpy.types.Scene.action_merge_settings = bpy.props.PointerProperty(type=ActionMergeSettings)
        bpy.types.Scene.convert_blp_textures = bpy.props.BoolProperty(name="转换BLP贴图", default=True)
        bpy.types.Scene.simple_fbx_my_scale = bpy.props.FloatProperty(name="缩放比例", min=0.001, max=1000.0, default=1.0)
        bpy.types.Scene.last_imported_fbx_path = bpy.props.StringProperty(name="最后导入的FBX路径", default="")
        bpy.types.Scene.mdl_export_optimize_animation = bpy.props.BoolProperty(name="优化动画", default=True)
        bpy.types.Scene.mdl_export_optimize_tolerance = bpy.props.FloatProperty(name="优化阈值", default=0.0001, min=0.000001, max=1.0, precision=6)
        bpy.types.Scene.show_keyframe_mover = bpy.props.BoolProperty(name="显示关键帧移动", default=False)
        bpy.types.Scene.keyframe_move_offset_x = bpy.props.FloatProperty(name="X", default=0.0, min=-1000.0, max=1000.0, precision=4)
        bpy.types.Scene.keyframe_move_offset_y = bpy.props.FloatProperty(name="Y", default=0.0, min=-1000.0, max=1000.0, precision=4)
        bpy.types.Scene.keyframe_move_offset_z = bpy.props.FloatProperty(name="Z", default=0.0, min=-1000.0, max=1000.0, precision=4)
        bpy.types.Scene.keyframe_rotate_offset_x = bpy.props.FloatProperty(name="X", default=0.0, min=-360.0, max=360.0, precision=2)
        bpy.types.Scene.keyframe_rotate_offset_y = bpy.props.FloatProperty(name="Y", default=0.0, min=-360.0, max=360.0, precision=2)
        bpy.types.Scene.keyframe_rotate_offset_z = bpy.props.FloatProperty(name="Z", default=0.0, min=-360.0, max=360.0, precision=2)
        bpy.types.Scene.show_action_list = bpy.props.BoolProperty(name="显示动作列表", default=True)
        bpy.types.Scene.show_animation_stabilizer = bpy.props.BoolProperty(name="显示动画平滑", default=False)
        bpy.types.Scene.animation_stabilizer_settings = bpy.props.PointerProperty(type=AnimationStabilizerSettings)
        bpy.types.Scene.bone_align_settings = bpy.props.PointerProperty(type=BoneAlignSettings)
        bpy.types.Scene.keyframe_cleaner_settings = bpy.props.PointerProperty(type=KeyframeCleanerSettings)
        bpy.types.Scene.keyframe_locker_settings = bpy.props.PointerProperty(type=KeyframeLockerSettings)
    except Exception as e:
        print(f"Warn: 无法注册 Scene 属性: {e}")
    try:
        mdl_layer_utils.register_mdl_properties()
    except Exception: 
        pass
    if on_animation_stop not in bpy.app.handlers.frame_change_pre:
        bpy.app.handlers.frame_change_pre.append(on_animation_stop)
def unregister():
    if on_animation_stop in bpy.app.handlers.frame_change_pre:
        try:
            bpy.app.handlers.frame_change_pre.remove(on_animation_stop)
        except Exception: pass
    try:
        mdl_layer_utils.unregister_mdl_properties()
    except Exception: pass
    try:
        del bpy.types.Scene.animation_clips
        del bpy.types.Scene.animation_list_index
        del bpy.types.Scene.show_animation_manager
        del bpy.types.Scene.show_action_list
        del bpy.types.Scene.bone_align_settings
        del bpy.types.Scene.show_merge_settings
        del bpy.types.Scene.show_optimization_tools
        del bpy.types.Scene.show_bone_aligner
        del bpy.types.Scene.keyframe_cleaner_settings
        del bpy.types.Scene.keyframe_locker_settings
        del bpy.types.Scene.keep_x_axis
        del bpy.types.Scene.keep_y_axis
        del bpy.types.Scene.keep_z_axis
        del bpy.types.Scene.show_outline_settings
        del bpy.types.Scene.oh_outline_thickness
        del bpy.types.Scene.oh_apply_scale
        del bpy.types.Scene.oh_outline_color
        del bpy.types.Scene.action_merge_settings
        del bpy.types.Scene.convert_blp_textures
        del bpy.types.Scene.simple_fbx_my_scale
        del bpy.types.Scene.last_imported_fbx_path
        del bpy.types.Scene.mdl_export_optimize_animation
        del bpy.types.Scene.mdl_export_optimize_tolerance
        del bpy.types.Scene.show_keyframe_mover
        del bpy.types.Scene.keyframe_move_offset_x
        del bpy.types.Scene.keyframe_move_offset_y
        del bpy.types.Scene.keyframe_move_offset_z
        del bpy.types.Scene.show_action_list
        del bpy.types.Scene.show_animation_stabilizer
        del bpy.types.Scene.animation_stabilizer_settings
        del bpy.types.Scene.bone_align_settings
    except Exception: pass
    try:
        del bpy.types.WindowManager.addon_update_available
        del bpy.types.WindowManager.addon_update_download_url  
        del bpy.types.WindowManager.addon_new_version
        del bpy.types.WindowManager.addon_current_version
        del bpy.types.WindowManager.addon_last_update_check_time
        del bpy.types.WindowManager.addon_update_changelog
        del bpy.types.Scene.show_keyframe_tools
    except Exception: pass
    property_group_classes = [
        AnimationClip,
        ActionItem,
        ActionMergeSettings,
        AnimationStabilizerSettings,
        BoneAlignSettings,
    ]
    update_classes = [
        UPDATE_OT_check_for_updates,
        UPDATE_OT_show_update_dialog, 
        UPDATE_OT_perform_update,
        UPDATE_OT_show_restart_dialog
    ]
    other_classes = [
        ANIMATION_UL_list,
        ANIMATION_OT_refresh_list,
        ANIMATION_OT_play_selected,
        ANIMATION_OT_set_full_range,
        ANIMATION_OT_ImportFromTxt,
        ANIMATION_OT_ExportToTxt,
        wm_OT_toggle_animation_manager,
        VIEW3D_OT_add_attachment_points,
        OH_OT_Add_Outline_Operator,
        OH_OT_Remove_Operator,
        wm_OT_toggle_outline_settings,
        wm_OT_toggle_keyframe_mover,
        wm_OT_toggle_animation_stabilizer,
        wm_OT_toggle_merge_settings,
        wm_OT_toggle_optimization_tools,
        wm_OT_toggle_bone_aligner,
        ANIM_OT_stabilize_animation,
        ANIM_OT_stabilize_animation_all_clips,
        ANIM_OT_keyframe_move_normal,
        ANIM_OT_keyframe_move_normal_all,
        ANIM_OT_keyframe_move_smart,
        ANIM_OT_keyframe_move_smart_all,
        LICENSE_OT_copy_machine_code,
        ACTION_OT_refresh_actions,
        ACTION_OT_clean_anim_data,
        ANIM_OT_align_bone_to_origin,
        ANIM_OT_align_all_bones_to_origin,
        ACTION_OT_merge,
        ACTION_OT_select_all_actions,
        VIEW3D_PT_merge_actions,
        ACTION_OT_convert_to_mdl,
        VIEW3D_OT_import_fbx,
        VIEW3D_OT_batch_import_fbx,
        VIEW3D_OT_export_mdl,
        VIEW3D_OT_add_camera,
        VIEW3D_OT_add_collision,
        WAR3_OT_add_mdl_layer_to_all_materials,
        MATERIAL_OT_split_by_material,
        ACTION_OT_preview_action,
        INTERNAL_OT_convert_blp_textures,
        SimpleFBXExport,
        BLENDERANIM_MT_preferences,
        ACTION_OT_optimize_animation_curves,
        wm_OT_toggle_keyframe_cleaner,
        wm_OT_toggle_keyframe_locker,
        ANIM_OT_lock_keyframes,
        wm_OT_toggle_keyframe_tools,
    ]
    classes_to_unregister = other_classes + update_classes
    for cls in reversed(classes_to_unregister):
        try:
            bpy.utils.unregister_class(cls)
        except Exception: pass
    for cls in reversed(property_group_classes):
        try:
            bpy.utils.unregister_class(cls)
        except Exception: pass
    try:
        bpy.utils.unregister_class(BoneAlignSettings)
    except Exception: pass
if __name__ == "__main__":
    register()