# -*- coding: utf-8 -*-
"""调频补偿费用导入与查询接口。"""

import json
import logging
import math
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from bson import json_util
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from webapp.api.dependencies.authz import require_permission
from webapp.tools.mongo import DATABASE
from webapp.tools.security import User, get_current_active_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/freq-comp-fee", tags=["调频补偿费用"])

COLLECTION = DATABASE["freq_comp_fee"]
VIEW_PERMISSION = "module:basic_monthly_manual_import:view"
EDIT_PERMISSION = "module:basic_monthly_manual_import:edit"

NUMBER_PATTERN = re.compile(r"^-?\d+(?:\.\d+)?$")
MONTH_SPECIFIC_PATTERNS = (
    re.compile(r"(20\d{2})\s*年\s*(\d{1,2})\s*月\s*江西电力调频辅助服务市场费用表"),
    re.compile(r"(20\d{2})\s*年\s*(\d{1,2})\s*月.{0,40}调频辅助服务市场费用", re.S),
)
MONTH_PATTERN = re.compile(r"(20\d{2})\s*年\s*(\d{1,2})\s*月")


def _is_number(value: str) -> bool:
    return bool(NUMBER_PATTERN.match(value.replace(",", "").strip()))


def _to_float(value: str) -> float:
    try:
        numeric = float(value.replace(",", "").strip())
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"数值解析失败：{value}")
    if math.isnan(numeric):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"数值解析失败：{value}")
    return numeric


def _extract_text_from_pdf(content: bytes) -> str:
    try:
        import fitz

        with fitz.open(stream=content, filetype="pdf") as doc:
            return "\n".join(page.get_text("text") for page in doc)
    except Exception as exc:
        logger.error("freq compensation pdf parse error: %s", exc, exc_info=True)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"PDF 文件解析失败：{exc}")


def _format_month(year: str, month: str) -> str:
    return f"{int(year):04d}{int(month):02d}"


def _extract_month(text: str, filename: str) -> str:
    for pattern in MONTH_SPECIFIC_PATTERNS:
        match = pattern.search(text)
        if match:
            return _format_month(match.group(1), match.group(2))

    for pattern in MONTH_SPECIFIC_PATTERNS:
        match = pattern.search(filename)
        if match:
            return _format_month(match.group(1), match.group(2))

    text_matches = MONTH_PATTERN.findall(text)
    if text_matches:
        year, month = text_matches[-1]
        return _format_month(year, month)

    filename_match = MONTH_PATTERN.search(filename)
    if filename_match:
        return _format_month(filename_match.group(1), filename_match.group(2))

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="未能从 PDF 文件中识别费用年月")


def _is_summary_row(plant_name: str) -> bool:
    return plant_name == "合计" or plant_name.endswith("合计")


def _parse_fee_table(text: str) -> List[Dict[str, Any]]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    records: List[Dict[str, Any]] = []
    index = 0

    while index < len(lines):
        current = lines[index]
        if not current.isdigit():
            index += 1
            continue

        if index + 5 >= len(lines):
            index += 1
            continue

        plant_name = lines[index + 1].strip()
        numeric_lines = lines[index + 2 : index + 6]
        if not plant_name or not all(_is_number(value) for value in numeric_lines):
            index += 1
            continue

        if not _is_summary_row(plant_name):
            records.append(
                {
                    "order": int(current),
                    "plant_name": plant_name,
                    "on_grid_energy": _to_float(numeric_lines[0]),
                    "compensation_fee": _to_float(numeric_lines[1]),
                    "allocation_fee": _to_float(numeric_lines[2]),
                    "settlement_fee": _to_float(numeric_lines[3]),
                }
            )

        index += 6

    if not records:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="未能从调频辅助服务市场费用表中提取有效电厂行")

    return records


def _parse_pdf(content: bytes, filename: str) -> Tuple[str, List[Dict[str, Any]]]:
    text = _extract_text_from_pdf(content)
    month = _extract_month(text, filename)
    records = _parse_fee_table(text)
    return month, records


@router.get("", summary="获取调频补偿费用月份列表")
def list_freq_comp_fee_months(_: Any = Depends(require_permission(VIEW_PERMISSION))) -> Dict[str, Any]:
    try:
        pipeline = [
            {
                "$group": {
                    "_id": "$month",
                    "month": {"$first": "$month"},
                    "count": {"$sum": 1},
                    "imported_at": {"$max": "$imported_at"},
                    "imported_by": {"$last": "$imported_by"},
                    "source_file_name": {"$last": "$source_file_name"},
                }
            },
            {"$sort": {"_id": -1}},
        ]
        docs = list(COLLECTION.aggregate(pipeline))
        return json.loads(json_util.dumps({"months": docs}))
    except Exception as exc:
        logger.error("list_freq_comp_fee_months error: %s", exc, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))


@router.get("/{month}", summary="获取指定年月调频补偿费用")
def get_freq_comp_fee(month: str, _: Any = Depends(require_permission(VIEW_PERMISSION))) -> Dict[str, Any]:
    if not re.fullmatch(r"\d{6}", month):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="年月格式无效，应为 YYYYMM")

    try:
        records = list(
            COLLECTION.find({"month": month}, {"_id": 0}).sort(
                [("order", 1), ("plant_name", 1)]
            )
        )
        if not records:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"年月 {month} 的调频补偿费用数据不存在")
        return json.loads(json_util.dumps({"month": month, "records": records}))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_freq_comp_fee error: %s", exc, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))


@router.post("/import", summary="导入调频辅助服务费用 PDF")
async def import_freq_comp_fee(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user),
    _: Any = Depends(require_permission(EDIT_PERMISSION)),
) -> Dict[str, Any]:
    filename = file.filename or ""
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="只支持 PDF 文件（.pdf）")

    content = await file.read()
    month, records = _parse_pdf(content, filename)
    now = datetime.now()
    record_ids = [f"{month}:{record['plant_name']}" for record in records]

    try:
        COLLECTION.delete_many({"month": month, "_id": {"$nin": record_ids}})
        for record in records:
            doc = {
                "_id": f"{month}:{record['plant_name']}",
                "month": month,
                "plant_name": record["plant_name"],
                "order": record["order"],
                "on_grid_energy": record["on_grid_energy"],
                "compensation_fee": record["compensation_fee"],
                "allocation_fee": record["allocation_fee"],
                "settlement_fee": record["settlement_fee"],
                "source_file_name": filename,
                "imported_at": now,
                "imported_by": current_user.username,
            }
            COLLECTION.replace_one({"_id": doc["_id"]}, doc, upsert=True)
    except Exception as exc:
        logger.error("import_freq_comp_fee db error: %s", exc, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))

    logger.info("年月 %s 调频补偿费用已导入，记录数：%s，操作人：%s", month, len(records), current_user.username)
    return {"status": "success", "month": month, "count": len(records)}


@router.delete("/{month}", summary="删除指定年月调频补偿费用")
def delete_freq_comp_fee(
    month: str,
    current_user: User = Depends(get_current_active_user),
    _: Any = Depends(require_permission(EDIT_PERMISSION)),
) -> Dict[str, Any]:
    if not re.fullmatch(r"\d{6}", month):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="年月格式无效，应为 YYYYMM")

    result = COLLECTION.delete_many({"month": month})
    if result.deleted_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"年月 {month} 的调频补偿费用数据不存在")

    logger.info("年月 %s 调频补偿费用已删除，记录数：%s，操作人：%s", month, result.deleted_count, current_user.username)
    return {"status": "success", "deleted_month": month, "deleted_count": result.deleted_count}
