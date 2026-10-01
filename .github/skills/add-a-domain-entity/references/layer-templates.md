# Entity layer templates

Copy-paste skeletons for `add-a-domain-entity`. Replace `Obligation` / `obligation` throughout.

These show the **shape and the boundaries**, not a complete implementation. Fill in the fields your
entity actually needs — do not carry over columns you do not use.

## Model — `app/models/obligation.py`

```python
from datetime import date
from uuid import UUID

from sqlalchemy import Date, Enum, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import TimestampedBase
from app.models.enums import ObligationStatus


class Obligation(TimestampedBase):
    """A commitment arising from an agreement. Icertis calls this a Commitment
    or Compliance - see docs/domain/ENTITY_REGISTRY.md."""

    __tablename__ = "obligation"

    agreement_id: Mapped[UUID] = mapped_column(
        ForeignKey("agreement.id", name="fk_obligation_agreement_id"), index=True
    )
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text)
    owner_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id", name="fk_obligation_owner_id"))
    due_date: Mapped[date]
    status: Mapped[ObligationStatus] = mapped_column(
        Enum(ObligationStatus, name="obligation_status"), default=ObligationStatus.draft
    )

    # Access-scope keys. The repository filters on these; without them the
    # entity cannot be scoped and must not be created.
    business_unit_id: Mapped[UUID] = mapped_column(
        ForeignKey("business_unit.id", name="fk_obligation_business_unit_id"), index=True
    )
    is_confidential: Mapped[bool] = mapped_column(default=False)

    # Dynamic attributes defined per contract type. JSONB + GIN, never EAV.
    attributes: Mapped[dict] = mapped_column(JSONB, default=dict)

    agreement: Mapped["Agreement"] = relationship(back_populates="obligations")

    __table_args__ = (
        Index("ix_obligation_attributes", "attributes", postgresql_using="gin"),
        Index("ix_obligation_due_date_status", "due_date", "status"),
    )
```

## Schemas — `app/schemas/obligation.py`

```python
from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import ObligationStatus


class ObligationCreate(BaseModel):
    agreement_id: UUID = Field(description="Agreement this obligation arises from")
    title: Annotated[str, Field(min_length=1, max_length=500, description="Short summary")]
    description: str | None = Field(default=None, description="Full obligation text")
    owner_id: UUID = Field(description="User accountable for fulfilment")
    due_date: date = Field(description="Date by which the obligation must be met")
    attributes: dict = Field(default_factory=dict, description="Contract-type specific fields")


class ObligationUpdate(BaseModel):
    """Every field optional - this backs PATCH."""

    title: Annotated[str | None, Field(default=None, min_length=1, max_length=500)]
    description: str | None = None
    owner_id: UUID | None = None
    due_date: date | None = None
    attributes: dict | None = None


class ObligationSummary(BaseModel):
    """The narrower shape list endpoints return."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    status: ObligationStatus
    due_date: date
    owner_id: UUID


class ObligationRead(ObligationSummary):
    """Detail payload. Scope keys are deliberately not exposed."""

    agreement_id: UUID
    description: str | None
    attributes: dict
    created_at: datetime
    updated_at: datetime
```

## Repository — `app/repositories/obligation.py`

```python
from uuid import UUID

from sqlalchemy import select

from app.models.obligation import Obligation
from app.repositories.base import ScopedRepository


class ObligationRepository(ScopedRepository[Obligation]):
    model = Obligation

    async def list_overdue(self, *, page: int, page_size: int) -> Page[Obligation]:
        stmt = (
            select(Obligation)
            .where(Obligation.due_date < func.current_date())
            .where(Obligation.status != ObligationStatus.fulfilled)
        )
        # Every select passes through _scoped(). Omitting this is a security bug.
        return await self.paginate(self._scoped(stmt), page=page, page_size=page_size)
```

## Service — `app/services/obligation.py`

```python
from uuid import UUID

from app.core.errors import IllegalTransition, NotFound
from app.models.enums import ObligationStatus
from app.schemas.obligation import ObligationCreate, ObligationRead
from app.services.base import AuditedService

_LEGAL_TRANSITIONS = {
    ObligationStatus.draft: {ObligationStatus.active, ObligationStatus.cancelled},
    ObligationStatus.active: {ObligationStatus.fulfilled, ObligationStatus.breached},
    ObligationStatus.fulfilled: set(),
    ObligationStatus.breached: {ObligationStatus.fulfilled},
    ObligationStatus.cancelled: set(),
}


class ObligationService(AuditedService):
    """Business rules for obligations. No FastAPI imports, no SQL."""

    def __init__(self, repo: ObligationRepository, principal: Principal) -> None:
        self._repo = repo
        self._principal = principal

    async def get(self, obligation_id: UUID) -> ObligationRead:
        obligation = await self._repo.get(obligation_id)
        if obligation is None:
            # Out of scope and non-existent are indistinguishable by design.
            raise NotFound("obligation", obligation_id)
        return ObligationRead.model_validate(obligation)

    async def fulfil(self, obligation_id: UUID) -> ObligationRead:
        obligation = await self._repo.get(obligation_id)
        if obligation is None:
            raise NotFound("obligation", obligation_id)

        self._assert_transition(obligation.status, ObligationStatus.fulfilled)

        before = self._snapshot(obligation)
        obligation.status = ObligationStatus.fulfilled
        await self._repo.flush()
        # Same transaction as the change. If this fails, the change rolls back.
        await self.audit("obligation.fulfil", obligation, before=before)

        return ObligationRead.model_validate(obligation)

    @staticmethod
    def _assert_transition(current: ObligationStatus, target: ObligationStatus) -> None:
        if target not in _LEGAL_TRANSITIONS[current]:
            raise IllegalTransition("obligation", current, target)
```

## Router — `app/api/obligations.py`

```python
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_obligation_service, require
from app.schemas.obligation import ObligationCreate, ObligationRead, ObligationSummary
from app.schemas.page import Page

router = APIRouter(prefix="/obligations", tags=["obligations"])


@router.get("", operation_id="listObligations", response_model=Page[ObligationSummary])
async def list_obligations(
    service: Annotated[ObligationService, Depends(get_obligation_service)],
    _: Annotated[None, Depends(require("obligation:read"))],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 10,   # default 10, always
    sort: Annotated[str, Query()] = "due_date",
    order: Annotated[Literal["asc", "desc"], Query()] = "asc",
) -> Page[ObligationSummary]:
    return await service.list(page=page, page_size=page_size, sort=sort, order=order)


@router.get("/{obligation_id}", operation_id="getObligation", response_model=ObligationRead)
async def get_obligation(
    obligation_id: UUID,
    service: Annotated[ObligationService, Depends(get_obligation_service)],
    _: Annotated[None, Depends(require("obligation:read"))],
) -> ObligationRead:
    return await service.get(obligation_id)


@router.post(
    "/{obligation_id}/fulfil",
    operation_id="fulfilObligation",
    response_model=ObligationRead,
)
async def fulfil_obligation(
    obligation_id: UUID,
    service: Annotated[ObligationService, Depends(get_obligation_service)],
    _: Annotated[None, Depends(require("obligation:update"))],
) -> ObligationRead:
    # A transition, not a PATCH that sets status - transitions have rules.
    return await service.fulfil(obligation_id)
```

## Tests — `tests/api/test_obligations.py`

```python
async def test_authorized_caller_can_read(client, contract_manager_token, obligation):
    r = await client.get(f"/api/v1/obligations/{obligation.id}", headers=contract_manager_token)
    assert r.status_code == 200


async def test_missing_permission_returns_403(client, viewer_token, obligation):
    r = await client.post(
        f"/api/v1/obligations/{obligation.id}/fulfil", headers=viewer_token
    )
    assert r.status_code == 403


async def test_out_of_scope_record_returns_404_and_reveals_nothing(
    client, contract_manager_token, other_business_unit_obligation
):
    r = await client.get(
        f"/api/v1/obligations/{other_business_unit_obligation.id}",
        headers=contract_manager_token,
    )
    # 403 would confirm the record exists. 404 does not.
    assert r.status_code == 404
    assert other_business_unit_obligation.title not in r.text


async def test_no_token_returns_401(client, obligation):
    r = await client.get(f"/api/v1/obligations/{obligation.id}")
    assert r.status_code == 401


async def test_list_defaults_to_page_size_10(client, contract_manager_token, many_obligations):
    r = await client.get("/api/v1/obligations", headers=contract_manager_token)
    assert r.json()["page_size"] == 10
    assert len(r.json()["items"]) == 10
```
