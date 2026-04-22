"""
Common columns used after normalizing the three policy APIs.

These columns are intentionally close to the filters shown on the official
websites, so the combined CSV can be filtered in a familiar way.
"""

COMMON_COLUMNS = [
    "source",
    "source_id",
    "title",
    "summary",
    "category",
    "subcategory",
    "region",
    "supervising_agency",
    "operating_agency",
    "target_group",
    "target_age",
    "target_detail",
    "income_condition",
    "startup_stage",
    "support_type",
    "application_method",
    "required_documents",
    "additional_conditions",
    "apply_start",
    "apply_end",
    "detail_url",
    "raw_json",
]
