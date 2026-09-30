#!/usr/bin/env python3
"""Check the checked-in Xcode project without Xcode. Does not compile Swift."""

from pathlib import Path
import json
import plistlib
import re
import struct
import sys
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]


def parse_openstep(text):
    """Read the small OpenStep plist grammar used by a .pbxproj."""
    pattern = re.compile(
        r'/\*.*?\*/|//[^\n]*|"(?:\\.|[^"\\])*"|[{}()=;,]|[^\s{}()=;,]+',
        re.S,
    )
    tokens = [t for t in pattern.findall(text) if not t.startswith(('/*', '//'))]
    index = 0

    def consume(expected=None):
        nonlocal index
        if index >= len(tokens):
            raise ValueError('Unexpected end of project')
        token = tokens[index]
        index += 1
        if expected is not None and token != expected:
            raise ValueError(f'Expected {expected!r}, found {token!r}')
        return token

    def value():
        token = consume()
        if token == '{':
            result = {}
            while tokens[index] != '}':
                key = consume().strip('"')
                consume('=')
                if key in result:
                    raise ValueError(f'Duplicate project key: {key}')
                result[key] = value()
                consume(';')
            consume('}')
            return result
        if token == '(':
            result = []
            while tokens[index] != ')':
                result.append(value())
                if tokens[index] == ',':
                    consume(',')
                elif tokens[index] != ')':
                    raise ValueError('Missing comma in project list')
            consume(')')
            return result
        return token[1:-1] if token.startswith('"') else token

    result = value()
    if index != len(tokens):
        raise ValueError('Trailing project tokens')
    return result


def verify_project():
    path = ROOT / 'CanadaPayCalculator.xcodeproj/project.pbxproj'
    project = parse_openstep(path.read_text(encoding='utf-8-sig'))
    objects = project['objects']
    project_object = objects[project['rootObject']]
    assert project_object['isa'] == 'PBXProject'
    targets = [objects[t] for t in project_object['targets']]
    assert any(t['productType'] == 'com.apple.product-type.application' for t in targets)
    assert any(t['productType'] == 'com.apple.product-type.bundle.unit-test' for t in targets)

    reference_fields = {
        'mainGroup', 'productRefGroup', 'buildConfigurationList', 'productReference',
        'fileRef', 'target', 'targetProxy', 'containerPortal', 'productRef', 'package',
    }
    reference_lists = {
        'targets', 'children', 'buildPhases', 'buildConfigurations', 'files',
        'dependencies', 'packageReferences', 'packageProductDependencies',
        'fileSystemSynchronizedGroups', 'exceptions',
    }
    for object_id, obj in objects.items():
        for key in reference_fields:
            if key in obj:
                assert obj[key] in objects, f'{object_id}.{key} references missing {obj[key]}'
        for key in reference_lists:
            for ref in obj.get(key, []):
                assert ref in objects, f'{object_id}.{key} references missing {ref}'

    # Resolve group-relative paths, then check every source appears in its target.
    resolved = {}

    def visit(ref, parent):
        obj = objects[ref]
        path = obj.get('path', '')
        tree = obj.get('sourceTree', '<group>')
        base = ROOT if tree == 'SOURCE_ROOT' else parent
        location = base / path
        resolved[ref] = location
        if obj['isa'] in {'PBXGroup', 'PBXFileSystemSynchronizedRootGroup'}:
            for child in obj.get('children', []):
                visit(child, location)

    visit(project_object['mainGroup'], ROOT)
    for target in targets:
        expected_root = ROOT / ('CanadaPayCalculator' if target['productType'].endswith('application')
                                else 'Tests/PayrollCoreTests')
        expected = {p.resolve() for p in expected_root.rglob('*.swift')}
        included = set()
        for phase_ref in target.get('buildPhases', []):
            phase = objects[phase_ref]
            if phase['isa'] == 'PBXSourcesBuildPhase':
                for build_ref in phase.get('files', []):
                    file_ref = objects[build_ref]['fileRef']
                    source = resolved.get(file_ref)
                    assert source is not None and source.is_file(), f'Missing source: {file_ref}'
                    included.add(source.resolve())
        for group_ref in target.get('fileSystemSynchronizedGroups', []):
            included.update(p.resolve() for p in resolved[group_ref].rglob('*.swift'))
        assert expected, f'No sources in {expected_root}'
        assert expected <= included, f'Unregistered target sources: {expected - included}'

    package_refs = [o for o in objects.values() if o['isa'] == 'XCLocalSwiftPackageReference']
    assert any(o['relativePath'] in {'.', './'} for o in package_refs), 'Missing local payroll package'
    products = [o for o in objects.values() if o['isa'] == 'XCSwiftPackageProductDependency']
    assert any(o['productName'] == 'PayrollCore' for o in products)

    scheme_paths = list((ROOT / 'CanadaPayCalculator.xcodeproj/xcshareddata/xcschemes').glob('*.xcscheme'))
    assert scheme_paths, 'Missing shared Xcode scheme'
    for scheme_path in scheme_paths:
        scheme = ET.parse(scheme_path)
        assert scheme.find('.//TestableReference') is not None, 'Scheme has no tests'
        for buildable in scheme.iter('BuildableReference'):
            ref = buildable.attrib['BlueprintIdentifier']
            assert ref in objects, f'Scheme references missing target {ref}'
    print(f'PASS: Xcode project references, source membership, local package, and {len(scheme_paths)} scheme(s)')


def verify_resources():
    plists = list(ROOT.glob('CanadaPayCalculator/**/*.plist')) + list(ROOT.glob('**/*.xcprivacy'))
    assert plists, 'Missing privacy manifest'
    for path in plists:
        with path.open('rb') as stream:
            plistlib.load(stream)
    assets = list((ROOT / 'CanadaPayCalculator/Assets.xcassets').rglob('Contents.json'))
    assert assets, 'Missing asset catalog'
    icon_found = False
    for path in assets:
        content = json.loads(path.read_text(encoding='utf-8-sig'))
        for entry in content.get('images', []):
            if 'filename' in entry:
                image_path = path.parent / entry['filename']
                assert image_path.is_file(), f'Missing image: {image_path}'
                if path.parent.name == 'AppIcon.appiconset':
                    data = image_path.read_bytes()
                    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'Icon must be PNG'
                    width, height = struct.unpack('>II', data[16:24])
                    assert (width, height) == (1024, 1024), 'Icon must be 1024 x 1024'
                    assert data[25] in {0, 2}, 'App Store icon must be opaque'
                    icon_found = True
    assert icon_found, 'Missing populated app icon'
    print(f'PASS: {len(plists)} plist/privacy file(s), {len(assets)} asset description(s), and opaque app icon')


def verify_architecture():
    core = list((ROOT / 'Sources/PayrollCore').rglob('*.swift'))
    tests = list((ROOT / 'Tests/PayrollCoreTests').rglob('*.swift'))
    assert core and tests, 'Missing payroll core or Swift unit tests'
    assert all('import SwiftUI' not in p.read_text(encoding='utf-8-sig') for p in core)
    manifest = (ROOT / 'Package.swift').read_text(encoding='utf-8-sig')
    assert 'PayrollCore' in manifest and '.testTarget' in manifest
    assert (ROOT / 'README.md').is_file()
    for required in ['App/CanadaPayCalculatorApp.swift', 'ViewModels/CalculatorViewModel.swift',
                     'Views/CalculatorView.swift', 'Views/AboutSheet.swift']:
        assert (ROOT / 'CanadaPayCalculator' / required).is_file(), f'Missing app component: {required}'
    test_count = sum(len(re.findall(r'func test\w+\(', p.read_text(encoding='utf-8-sig'))) for p in tests)
    assert test_count >= 7, 'Missing requested payroll test scenarios'
    print(f'PASS: {len(core)} standalone payroll source(s), {test_count} XCTest methods, app components, package, and README')


if __name__ == '__main__':
    try:
        verify_project()
        verify_resources()
        verify_architecture()
    except (AssertionError, ValueError, KeyError, IndexError, OSError) as error:
        print(f'FAIL: {error}', file=sys.stderr)
        sys.exit(1)
    print('Repository checks passed. Swift compilation and simulator tests still require a Swift/Xcode host.')
