import { spawnSync } from "node:child_process";

const SCRIPT = String.raw`
import sys, json, zipfile, io, html

workbook = json.load(sys.stdin)
sheet = workbook["sheets"][0]
name = sheet.get("name") or "Sheet1"

def esc(value):
    return html.escape(str(value), quote=False)

def attrs(cell):
    return f'r="{cell["ref"]}"'

rows = {}
for cell in sheet.get("cells", []):
    rows.setdefault(int(cell["row"]), []).append(cell)

row_xml = []
for row_no in sorted(rows):
    cells = []
    for cell in sorted(rows[row_no], key=lambda item: int(item["col"])):
        value = cell.get("value")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            cells.append(f'<c {attrs(cell)}><v>{value}</v></c>')
        elif isinstance(value, bool):
            cells.append(f'<c {attrs(cell)} t="b"><v>{1 if value else 0}</v></c>')
        else:
            cells.append(f'<c {attrs(cell)} t="inlineStr"><is><t xml:space="preserve">{esc(value if value is not None else "")}</t></is></c>')
    hidden = " hidden=\"1\"" if row_no in set(sheet.get("hiddenRows", [])) else ""
    row_xml.append(f'<row r="{row_no}"{hidden}>{"".join(cells)}</row>')

merges = sheet.get("merges", [])
merge_xml = ""
if merges:
    merge_xml = f'<mergeCells count="{len(merges)}">' + "".join(
        f'<mergeCell ref="{esc(item["ref"])}"/>' for item in merges
    ) + '</mergeCells>'

worksheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + \
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + \
    '<sheetData>' + ''.join(row_xml) + '</sheetData>' + merge_xml + '</worksheet>'

workbook_xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + \
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' + \
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' + \
    f'<sheets><sheet name="{html.escape(name, quote=True)}" sheetId="1" r:id="rId1"/></sheets></workbook>'

rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + \
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + \
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' + \
    '</Relationships>'

content_types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + \
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + \
    '<Default Extension="xml" ContentType="application/xml"/>' + \
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + \
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' + \
    '</Types>'

root_rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + \
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + \
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' + \
    '</Relationships>'

output = io.BytesIO()
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    archive.writestr("[Content_Types].xml", content_types)
    archive.writestr("_rels/.rels", root_rels)
    archive.writestr("xl/workbook.xml", workbook_xml)
    archive.writestr("xl/_rels/workbook.xml.rels", rels)
    archive.writestr("xl/worksheets/sheet1.xml", worksheet)

sys.stdout.buffer.write(output.getvalue())
`;

export function xlsxFromStructure(workbook) {
  const result = spawnSync("python3", ["-c", SCRIPT], {
    input: JSON.stringify(workbook),
    encoding: null,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`failed to build XLSX fixture: ${Buffer.from(result.stderr || "").toString("utf8")}`);
  }
  return Buffer.from(result.stdout);
}
