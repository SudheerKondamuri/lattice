"""Bounded, offline-only parser subprocess. No network or public endpoint."""
import base64
import io
import json
import os
import resource
import sys
import zipfile
from pathlib import Path

resource.setrlimit(resource.RLIMIT_CPU, (110, 110))
resource.setrlimit(resource.RLIMIT_AS, (4 * 1024**3, 4 * 1024**3))
resource.setrlimit(resource.RLIMIT_FSIZE, (32 * 1024**2, 32 * 1024**2))
resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
request = json.loads(sys.stdin.buffer.read(30 * 1024**2))
data = base64.b64decode(request['base64'], validate=True)
if len(data) > 20 * 1024**2:
    raise ValueError('File too large')
sections, warnings, ocr_pages = [], [], 0
if request['kind'] == 'qa_xlsx':
    from openpyxl import load_workbook
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) > 2000 or sum(x.file_size for x in entries) > 30 * 1024**2:
            raise ValueError('XLSX decompression limit')
    book = load_workbook(io.BytesIO(data), read_only=True, data_only=True, keep_links=False)
    sheet = book.worksheets[0]
    rows = sheet.iter_rows(values_only=True)
    headers = [str(x or '').strip().lower() for x in next(rows)]
    question, answer = headers.index('question'), headers.index('answer')
    for index, row in enumerate(rows, 2):
        if index > 2001:
            raise ValueError('Too many Q&A rows')
        if not any(row):
            continue
        q, a = str(row[question] or ''), str(row[answer] or '')
        if not q.strip() or not a.strip() or len(q) + len(a) > 20000:
            raise ValueError('Invalid Q&A row')
        sections.append({'text': f'Question: {q}\nAnswer: {a}', 'section': f'Q&A row {index}'})
    book.close()
    pages = max(1, sum(len(x['text']) for x in sections) // 6000 + 1)
elif request['kind'] == 'pdf':
    from pypdf import PdfReader, PdfWriter
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        raise ValueError('Encrypted PDF')
    total = len(reader.pages)
    pages = min(total, request['maxPages'])
    if total > pages:
        warnings.append(f'Only the first {pages} of {total} PDF pages were extracted')
    # OCR only if a bounded text probe suggests scanned pages. Never download models at runtime.
    scanned = any(len(reader.pages[i].extract_text() or '') < 30 for i in range(min(pages, 10)))
    if scanned:
        pages = min(pages, request['maxOcrPages'])
        ocr_pages = pages
        if total > pages:
            warnings.append(f'OCR capped at {pages} pages; extraction is partial')
    # Give Docling a physically bounded document, not just a page-range hint:
    # its document-wide page-count limit can reject an oversized original.
    if total > pages:
        writer = PdfWriter()
        for index in range(pages):
            writer.add_page(reader.pages[index])
        bounded = io.BytesIO()
        writer.write(bounded)
        data = bounded.getvalue()
    from docling.datamodel.base_models import DocumentStream, InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption
    options = PdfPipelineOptions(do_ocr=scanned, do_table_structure=True)
    artifacts = Path(os.environ.get('PARSER_ARTIFACTS_PATH', '/opt/docling-models'))
    if not artifacts.is_dir():
        raise RuntimeError('Offline Docling model directory is not configured')
    options.artifacts_path = artifacts
    options.ocr_options = RapidOcrOptions()
    options.document_timeout = 100
    options.accelerator_options.num_threads = 1
    options.enable_remote_services = False
    options.generate_picture_images = False
    converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})
    result = converter.convert(DocumentStream(name='upload.pdf', stream=io.BytesIO(data)), page_range=(1, pages), max_num_pages=pages)
    for page in range(1, pages + 1):
        text = result.document.export_to_markdown(page_no=page)
        if text.strip():
            sections.append({'text': text, 'page': page, 'section': f'Page {page}'})
        else:
            warnings.append(f'Page {page}: no text extracted')
    if str(result.status).lower().find('partial') >= 0:
        warnings.append('Docling reported partial extraction')
    if scanned:
        warnings.append('OCR-derived content requires human review; recognition may be inaccurate')
else:
    raise ValueError('Unsupported parser format')
if not sections:
    raise ValueError('Empty extraction')
if sum(len(x['text']) for x in sections) > 1000000:
    raise ValueError('Extracted text limit')
json.dump({'sections': sections, 'warnings': warnings, 'pageCount': pages, 'ocrPages': ocr_pages}, sys.stdout)
