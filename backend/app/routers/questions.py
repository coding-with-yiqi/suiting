import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Literal
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Question
from app.schemas import QuestionOut, QuestionUpdate
from app.services import gewe
from app.services.agents.orchestrator import get_live_orchestrator

router = APIRouter(prefix="/api/sessions/{session_id}/questions", tags=["questions"])


@router.get("", response_model=list[QuestionOut])
async def list_questions(session_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Question).where(Question.session_id == session_id).order_by(Question.created_at.desc())
    )
    return result.scalars().all()


@router.patch("/{question_id}", response_model=QuestionOut)
async def update_question(
    session_id: uuid.UUID, question_id: uuid.UUID, body: QuestionUpdate, db: AsyncSession = Depends(get_db)
):
    question = await db.get(Question, question_id)
    if not question or question.session_id != session_id:
        raise HTTPException(404, "Question not found")
    if body.question is not None:
        question.question = body.question
    if body.starred is not None:
        question.starred = body.starred
    if body.dismissed is not None:
        question.dismissed = body.dismissed
        if question.item_type == "community_post":
            if body.dismissed and question.delivery_state not in ("sent", "merged"):
                question.delivery_state = "ignored"
            elif not body.dismissed and question.delivery_state == "ignored":
                question.delivery_state = "pending"
    if body.vote is not None:
        question.vote = body.vote
    await db.commit()
    await db.refresh(question)
    if question.item_type == "community_post":
        orchestrator = get_live_orchestrator(session_id)
        if orchestrator:
            if question.dismissed and question.delivery_state == "ignored":
                orchestrator.defer_community_post(str(question.id), question.question)
            else:
                orchestrator.forget_deferred_post(str(question.id), question.question)
    return question


class WechatReview(BaseModel):
    content: str = Field(min_length=1, max_length=12000)
    targets: list[str] = Field(min_length=1, max_length=20)
    reviewed: Literal[True]


async def _wechat_question(session_id, question_id, db):
    question = await db.get(Question, question_id)
    if not question or question.session_id != session_id:
        raise HTTPException(404, "没有找到这条文案。")
    if question.dismissed or question.item_type != "community_post":
        raise HTTPException(409, "这条内容当前不能发送，请重新打开候选文案。")
    return question


def _review_origin(request):
    origin = request.headers.get("origin")
    if request.headers.get("x-rebroadcast-review") != "1" or (origin and origin != str(request.base_url).rstrip("/")):
        raise HTTPException(403, "请从本机的文案审核窗口操作。")


def _all_delivery_receipts_confirmed(receipts: dict) -> bool:
    """A candidate is final only when every selected target says sent."""
    return bool(receipts) and all(
        isinstance(receipt, dict) and receipt.get("state") == "sent"
        for receipt in receipts.values()
    )


@router.get("/{question_id}/wechat")
async def get_wechat_review(session_id: uuid.UUID, question_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    question = await _wechat_question(session_id, question_id, db)
    return gewe.review(question_id, question.question)


@router.post("/{question_id}/wechat/groups")
async def refresh_wechat_groups(session_id: uuid.UUID, question_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db)):
    _review_origin(request)
    await _wechat_question(session_id, question_id, db)
    try:
        return await gewe.refresh_groups()
    except gewe.GeweError as exc:
        raise HTTPException(502, str(exc)) from None


@router.post("/{question_id}/wechat")
async def send_to_wechat(session_id: uuid.UUID, question_id: uuid.UUID, body: WechatReview, request: Request, db: AsyncSession = Depends(get_db)):
    _review_origin(request)
    question = await _wechat_question(session_id, question_id, db)
    if question.question != body.content:
        raise HTTPException(409, "正文已有变化，请保存修改后重新审核。")
    try:
        receipts = await gewe.send_reviewed(question_id, body.content, body.targets)
    except gewe.GeweError as exc:
        raise HTTPException(502, str(exc)) from None
    # Keep a sent candidate visible in history, but stop treating it as a
    # fragment for the next generated post once every selected target has
    # confirmed delivery. Partial or unknown results remain retryable.
    if _all_delivery_receipts_confirmed(receipts):
        question.delivery_state = "sent"
        await db.commit()
        orchestrator = get_live_orchestrator(session_id)
        if orchestrator:
            orchestrator.forget_deferred_post(str(question.id), question.question)
    return receipts
