import base64
import io
import json
import subprocess
import sys
import unittest
from pathlib import Path
from openpyxl import Workbook
from pypdf import PdfWriter

class ParserTests(unittest.TestCase):
    def parse(self, kind, data):
        return subprocess.run([sys.executable, str(Path(__file__).with_name('parse.py'))], input=json.dumps({'kind': kind, 'base64': base64.b64encode(data).decode(), 'maxPages': 2, 'maxOcrPages': 1}), text=True, capture_output=True, timeout=20)

    def test_xlsx_qa_structure(self):
        book = Workbook()
        sheet = book.active
        sheet.append(['Question', 'Answer'])
        sheet.append(['Refund window?', '30 days'])
        output = io.BytesIO()
        book.save(output)
        result = self.parse('qa_xlsx', output.getvalue())
        self.assertEqual(result.returncode, 0, result.stderr)
        parsed = json.loads(result.stdout)
        self.assertEqual(parsed['sections'][0]['section'], 'Q&A row 2')
        self.assertIn('30 days', parsed['sections'][0]['text'])

    def test_invalid_xlsx_is_visible_failure(self):
        self.assertNotEqual(self.parse('qa_xlsx', b'not a spreadsheet').returncode, 0)

    def test_encrypted_pdf_is_rejected_before_layout_model(self):
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        writer.encrypt('test-only')
        output = io.BytesIO()
        writer.write(output)
        result = self.parse('pdf', output.getvalue())
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Encrypted PDF', result.stderr)

if __name__ == '__main__':
    unittest.main()
