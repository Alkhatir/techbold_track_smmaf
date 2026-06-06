"""Anthropic tool-use schemas for structured LLM outputs."""

ANALYSIS_TOOL: dict = {
    "name": "output_analysis",
    "description": "Output the structured ticket analysis result",
    "input_schema": {
        "type": "object",
        "properties": {
            "ticket_summary": {
                "type": "string",
                "description": "Brief summary of what the customer reported",
            },
            "affected_component": {
                "type": "string",
                "description": "Service or component likely affected (if inferable)",
            },
            "hypotheses": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "description": {"type": "string"},
                        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                        "supporting_evidence": {"type": "array", "items": {"type": "string"}},
                        "next_check": {"type": "string"},
                    },
                    "required": ["title", "description", "confidence", "next_check"],
                },
            },
            "proposed_commands": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string"},
                        "reason": {"type": "string"},
                        "expected_result": {"type": "string"},
                    },
                    "required": ["command", "reason", "expected_result"],
                },
            },
        },
        "required": ["ticket_summary", "hypotheses", "proposed_commands"],
    },
}

FIX_PLAN_TOOL: dict = {
    "name": "output_fix_plan",
    "description": "Output the fix plan based on gathered evidence",
    "input_schema": {
        "type": "object",
        "properties": {
            "root_cause": {
                "type": "string",
                "description": "The technical root cause (not the symptom)",
            },
            "evidence": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Evidence items supporting the root cause",
            },
            "needs_more_diagnostics": {
                "type": "boolean",
                "description": "True if evidence is insufficient for a safe fix",
            },
            "additional_diagnostic_commands": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string"},
                        "reason": {"type": "string"},
                        "expected_result": {"type": "string"},
                    },
                    "required": ["command", "reason", "expected_result"],
                },
            },
            "fix_commands": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string"},
                        "reason": {"type": "string"},
                        "expected_result": {"type": "string"},
                    },
                    "required": ["command", "reason", "expected_result"],
                },
            },
            "validation_commands": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string"},
                        "reason": {"type": "string"},
                        "expected_result": {"type": "string"},
                    },
                    "required": ["command", "reason", "expected_result"],
                },
            },
        },
        "required": ["root_cause", "needs_more_diagnostics", "fix_commands", "validation_commands"],
    },
}

ACTIVITY_TOOL: dict = {
    "name": "output_activity",
    "description": "Output the structured ERP activity log",
    "input_schema": {
        "type": "object",
        "properties": {
            "summary": {
                "type": "string",
                "description": "One sentence describing what was restored",
            },
            "root_cause": {
                "type": "string",
                "description": "Technical root cause — not the symptom",
            },
            "actions_taken": {
                "type": "string",
                "description": "Diagnosis and fix steps in order",
            },
            "commands_summary": {
                "type": "string",
                "description": "Relevant commands/command classes — NO secrets, NO raw output",
            },
            "validation_result": {
                "type": "string",
                "description": "Concrete proof that the customer benefit is restored",
            },
        },
        "required": ["summary", "root_cause", "actions_taken", "commands_summary", "validation_result"],
    },
}
