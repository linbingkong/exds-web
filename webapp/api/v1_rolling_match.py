# -*- coding: utf-8 -*-
"""月内交易行情接口。"""

import logging
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, Query, HTTPException, status

from webapp.api.dependencies.authz import require_permission
from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/rolling-match", tags=["月内交易行情"])

VALID_MORNING_SLOTS = {"09:30", "09:45", "10:00", "10:15", "10:30", "10:45", "11:00", "11:15", "11:30"}
VALID_AFTERNOON_SLOTS = {"14:00", "14:15", "14:30", "14:45", "15:00", "15:15", "15:30", "15:45", "16:00", "16:15", "16:30"}
ALL_VALID_SLOTS = VALID_MORNING_SLOTS | VALID_AFTERNOON_SLOTS

collection = DATABASE["rolling_match_snapshots"]


def _is_valid_slot(slot: str) -> bool:
    """判断轮次是否在有效时段内。"""
    return slot in ALL_VALID_SLOTS


def _get_jy_days_range(jy_time: str) -> List[str]:
    """获取交易日对应的 D+2 到 D+11 共 10 个成交日。"""
    try:
        base = datetime.strptime(jy_time, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"无效的日期格式: {jy_time}")
    return [(base + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(2, 12)]


@router.get("/days", summary="获取交易日 10 个标的日汇总（左栏数据）")
def get_rolling_match_days(
    jy_time: str = Query(..., description="交易日，格式 YYYY-MM-DD"),
    _=Depends(require_permission("module:rolling_match_quotes:view")),
):
    """返回该交易日 D+2 ~ D+11 共 10 个成交日的汇总电量。"""
    cj_days = _get_jy_days_range(jy_time)

    pipeline = [
        {"$match": {"jy_time": jy_time, "cj_time": {"$in": cj_days}}},
        {"$group": {
            "_id": "$cj_time",
            "sum_energy": {"$sum": "$summary.sum_energy"},
            "delivery_offset": {"$first": "$delivery_offset"},
        }},
        {"$sort": {"_id": 1}},
    ]

    rows = list(collection.aggregate(pipeline))
    result = []
    for cj_time in cj_days:
        row = next((r for r in rows if r["_id"] == cj_time), None)
        try:
            dt = datetime.strptime(cj_time, "%Y-%m-%d")
            weekday_names = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
            weekday = weekday_names[dt.weekday()]
        except Exception:
            weekday = ""
        offset = row["delivery_offset"] if row else (datetime.strptime(cj_time, "%Y-%m-%d") - datetime.strptime(jy_time, "%Y-%m-%d")).days
        result.append({
            "cj_time": cj_time,
            "label": f"D+{offset}",
            "weekday": weekday,
            "sum_energy": round(row["sum_energy"], 2) if row else None,
        })
    return result


@router.get("/rounds", summary="获取交易日有效轮次列表")
def get_rolling_match_rounds(
    jy_time: str = Query(..., description="交易日，格式 YYYY-MM-DD"),
    _=Depends(require_permission("module:rolling_match_quotes:view")),
):
    """返回该交易日有数据的有效撮合轮次列表。"""
    raw_slots = collection.distinct("snapshot_slot", {"jy_time": jy_time})
    valid_slots = sorted([s for s in raw_slots if _is_valid_slot(s)])
    return {"jy_time": jy_time, "rounds": valid_slots}


@router.get("/quotes", summary="获取单标的+轮次 48 时段行情（主表数据）")
def get_rolling_match_quotes(
    jy_time: str = Query(..., description="交易日，格式 YYYY-MM-DD"),
    cj_time: str = Query(..., description="成交（交割）日，格式 YYYY-MM-DD"),
    snapshot_slot: str = Query(..., description="撮合轮次，格式 HH:MM"),
    _=Depends(require_permission("module:rolling_match_quotes:view")),
):
    """返回指定标的+轮次的 48 时段行情数据。"""
    doc = collection.find_one(
        {"jy_time": jy_time, "cj_time": cj_time, "snapshot_slot": snapshot_slot},
        {"_id": 0, "periods": 1, "summary": 1, "trid": 1, "collected_at": 1},
    )
    if not doc:
        return {"jy_time": jy_time, "cj_time": cj_time, "snapshot_slot": snapshot_slot, "periods": [], "summary": None}

    periods = doc.get("periods", [])
    result_periods = []
    for p in periods:
        result_periods.append({
            "period": p.get("slot_id"),
            "time_label": p.get("time_label", ""),
            "sf_energy": p.get("sf_energy"),
            "gf_energy": p.get("gf_energy"),
            "last_price": p.get("last_price"),
            "last_energy": p.get("last_energy"),
            "sum_energy": p.get("sum_energy"),
            "sum_price": p.get("sum_price"),
        })
    result_periods.sort(key=lambda x: x["period"] or 0)

    return {
        "jy_time": jy_time,
        "cj_time": cj_time,
        "snapshot_slot": snapshot_slot,
        "summary": doc.get("summary"),
        "periods": result_periods,
    }


@router.get("/period-history", summary="获取指定交割日+时段的全轮次历史（Drawer 图表数据）")
def get_period_history(
    cj_time: str = Query(..., description="成交（交割）日，格式 YYYY-MM-DD"),
    period: int = Query(..., ge=1, le=48, description="时段序号 1-48"),
    _=Depends(require_permission("module:rolling_match_quotes:view")),
):
    """返回该「交割日+时段」从首日开始交易到最新轮次的全部历史快照数据，用于 Drawer 中的走势图。"""
    pipeline = [
        {"$match": {"cj_time": cj_time}},
        {"$project": {
            "_id": 0,
            "jy_time": 1,
            "snapshot_slot": 1,
            "collected_at": 1,
            "period_data": {
                "$filter": {
                    "input": "$periods",
                    "as": "p",
                    "cond": {"$eq": ["$$p.slot_id", period]},
                }
            },
        }},
        {"$match": {"period_data": {"$ne": []}}},
        {"$sort": {"jy_time": 1, "snapshot_slot": 1}},
    ]

    rows = list(collection.aggregate(pipeline))
    result = []
    for row in rows:
        slot = row.get("snapshot_slot", "")
        if not _is_valid_slot(slot):
            continue
        pd = row["period_data"][0] if row.get("period_data") else {}
        result.append({
            "jy_time": row["jy_time"],
            "snapshot_slot": slot,
            "x_label": f"{row['jy_time']} {slot}",
            "sum_price": pd.get("sum_price"),
            "sum_energy": pd.get("sum_energy"),
            "last_energy": pd.get("last_energy"),
            "sf_energy": pd.get("sf_energy"),
            "gf_energy": pd.get("gf_energy"),
            "last_price": pd.get("last_price"),
        })
    return {"cj_time": cj_time, "period": period, "history": result}
