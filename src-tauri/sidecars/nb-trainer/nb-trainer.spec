# -*- mode: python ; coding: utf-8 -*-

# Keep this list aligned with main.py's lazy imports. PyInstaller's maintained
# hooks collect each library's required binaries and data; collect_all(pandas)
# would also bundle pandas' complete test suite without adding runtime ability.
hiddenimports = [
    'models',
    'train',
    'predict',
    'protocol',
    'torch',
    'torchvision',
    'torchvision.datasets',
    'PIL',
    'numpy',
    'pandas',
]


a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['pandas.tests'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='nb-trainer',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='nb-trainer',
)
