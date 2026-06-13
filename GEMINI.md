# N.E.R.D. Development Mandates

## Validation Rules
- **E2E Live Testing**: Every code change MUST be validated by running the live end-to-end test suite. This ensures that changes to the parser, prompts, or services do not break the population of the NCADEMI product page sections.
- **Test Command**: `source venv312/bin/activate && export PYTHONPATH=$PYTHONPATH:. && python3 tests/e2e_live_validation.py`
- **Verification Criteria**:
    - Research must return a non-empty draft.
    - Parser must successfully map: Product Name, Vendor, Description, Vendor Resources, Third-Party Insights, and AI Insights.
    - HTML generation must include all primary sections from the NCADEMI template.

## Engineering Standards
- **Python Version**: 3.12 (as specified in `Dockerfile` and `requirements.txt`).
- **Dependency Management**: Load-bearing transitive pins are locked in `constraints.txt`. Use `-c constraints.txt` for all installations.
- **Robust Parsing**: Use flexible regex in `src/generators.py` to handle varied AI Markdown output (Standard, Parenthetical, or Raw URLs).
