"""Fast, GPU-free contract tests for the bundled training sidecar."""

import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest


TRAINER_DIR = Path(__file__).resolve().parent.parent
if str(TRAINER_DIR) not in sys.path:
    sys.path.insert(0, str(TRAINER_DIR))

from models import build_model  # noqa: E402
from protocol import TrainerError, log_message  # noqa: E402
from train import _partition_indices, _partition_stratified, safe_device  # noqa: E402


class ProtocolContractTests(unittest.TestCase):
    def test_trainer_error_keeps_stable_code_and_sanitizes_details(self):
        error = TrainerError('DATA_INVALID', 'bad input', details='not-an-object')

        self.assertEqual(error.error_code, 'DATA_INVALID')
        self.assertEqual(str(error), 'bad input')
        self.assertEqual(error.details, {})

    def test_log_message_emits_one_valid_json_line(self):
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            log_message('log', level='info', message='中文路径')

        lines = stream.getvalue().splitlines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(
            json.loads(lines[0]),
            {'type': 'log', 'level': 'info', 'message': '中文路径'},
        )


class EntryPointContractTests(unittest.TestCase):
    def run_sidecar(self, payload):
        environment = os.environ.copy()
        environment['PYTHONDONTWRITEBYTECODE'] = '1'
        return subprocess.run(
            [sys.executable, '-B', str(TRAINER_DIR / 'main.py')],
            input=payload,
            capture_output=True,
            check=False,
            encoding='utf-8',
            env=environment,
            timeout=20,
        )

    def assert_terminal_error(self, result, expected_code):
        self.assertNotEqual(result.returncode, 0)
        lines = [line for line in result.stdout.splitlines() if line.strip()]
        self.assertEqual(len(lines), 1, result.stdout)
        message = json.loads(lines[0])
        self.assertEqual(message['type'], 'error')
        self.assertEqual(message['status'], 'failed')
        self.assertEqual(message['errorCode'], expected_code)

    def test_missing_configuration_has_machine_readable_error(self):
        self.assert_terminal_error(self.run_sidecar(''), 'CONFIG_MISSING')

    def test_invalid_json_has_machine_readable_error(self):
        self.assert_terminal_error(self.run_sidecar('{broken\n'), 'CONFIG_JSON_INVALID')

    def test_non_object_configuration_is_rejected(self):
        self.assert_terminal_error(self.run_sidecar('[]\n'), 'CONFIG_TYPE_INVALID')

    def test_unknown_mode_is_rejected_before_model_or_torch_work(self):
        result = self.run_sidecar(json.dumps({'mode': 'future-mode'}) + '\n')
        self.assert_terminal_error(result, 'MODE_UNSUPPORTED')
        self.assertNotIn('INTERNAL_ERROR', result.stdout)


class ModelContractTests(unittest.TestCase):
    def test_empty_model_is_rejected_with_stable_code(self):
        with self.assertRaises(TrainerError) as captured:
            build_model([])
        self.assertEqual(captured.exception.error_code, 'MODEL_CONFIG_INVALID')

    def test_unknown_layer_is_rejected_instead_of_being_skipped(self):
        with self.assertRaises(TrainerError) as captured:
            build_model([{'id': 'x', 'type': 'FutureLayer', 'params': {}}])
        self.assertEqual(captured.exception.error_code, 'MODEL_LAYER_UNSUPPORTED')
        self.assertEqual(captured.exception.details['layerId'], 'x')

    def test_valid_linear_model_preserves_declared_shape(self):
        model, input_shape = build_model([
            {'type': 'Input', 'params': {'inChannels': 1, 'inputHeight': 1, 'inputWidth': 3}},
            {'type': 'Flatten', 'params': {}},
            {'type': 'Linear', 'params': {'inFeatures': 3, 'outFeatures': 1}},
        ])
        self.assertEqual(input_shape, (1, 1, 3))
        self.assertEqual(len(model), 2)


class SplitContractTests(unittest.TestCase):
    def assert_partition(self, train, validation, test, total):
        sets = [set(train), set(validation), set(test)]
        self.assertTrue(all(left.isdisjoint(right) for index, left in enumerate(sets) for right in sets[index + 1:]))
        self.assertEqual(set().union(*sets), set(range(total)))

    def test_random_split_is_deterministic_disjoint_and_exhaustive(self):
        first = _partition_indices(20, 0.2, 0.25, 42)
        second = _partition_indices(20, 0.2, 0.25, 42)
        self.assertEqual(first, second)
        self.assert_partition(*first, total=20)

    def test_group_split_never_leaks_a_group_across_sets(self):
        groups = ['a'] * 3 + ['b'] * 3 + ['c'] * 3 + ['d'] * 3
        train, validation, test = _partition_indices(
            len(groups), 0.25, 0.34, 7, strategy='group', groups=groups
        )
        self.assert_partition(train, validation, test, total=len(groups))
        memberships = [
            {groups[index] for index in indices}
            for indices in (train, validation, test)
        ]
        self.assertTrue(all(left.isdisjoint(right) for index, left in enumerate(memberships) for right in memberships[index + 1:]))

    def test_temporal_split_keeps_latest_samples_for_test(self):
        times = list(range(12))
        train, validation, test = _partition_indices(
            len(times), 0.25, 0.25, 99, strategy='temporal', times=times
        )
        self.assert_partition(train, validation, test, total=len(times))
        self.assertEqual(test, [9, 10, 11])
        self.assertLess(max(train), min(validation))
        self.assertLess(max(validation), min(test))

    def test_stratified_split_preserves_every_class(self):
        labels = [0] * 6 + [1] * 6
        train, validation, test = _partition_stratified(labels, 0.2, 0.25, 11)
        self.assert_partition(train, validation, test, total=len(labels))
        for indices in (train, validation, test):
            self.assertEqual({labels[index] for index in indices}, {0, 1})

    def test_unknown_device_never_silently_falls_back_to_cpu(self):
        with self.assertRaises(ValueError):
            safe_device('mps')


if __name__ == '__main__':
    unittest.main()
