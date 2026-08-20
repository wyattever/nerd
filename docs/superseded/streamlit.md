# Streamlit Best Practices & Architecture for EdTech Directory

This document outlines the mandatory patterns for ensuring UI reactivity, correct state persistence, and reliable element identity in the Streamlit-based EdTech Directory Assistant.

## 1. Execution Order & State Mutation
Streamlit follows a specific execution order when a user interacts with a widget:
1. The widget value is updated in `st.session_state`.
2. The **callback** function (if any) is executed.
3. The page **reruns** from top to bottom.

### Rules:
- **Mutate in Callbacks**: All persistent state updates (e.g., adding a resource to a list, updating a generated result) MUST happen inside an `on_click` or `on_change` callback.
- **Read in Body**: The main body of the script should be "read-only" with respect to the primary data state; it should simply render whatever is currently in `st.session_state`.
- **st.rerun() is a No-op**: Never call `st.rerun()` inside a callback. Streamlit already triggers a rerun automatically after the callback finishes.

## 2. Clearing Widget Inputs
Modifying a widget's value in `st.session_state` after it has been instantiated in the current run will raise a `StreamlitAPIException`.

### The "Gold Standard" Clearing Pattern:
To clear a text area or input field after a successful action (like "Add Resource"), you must assign an empty string to its key **inside the callback**.
```python
def add_resource_callback():
    # 1. Process the current value
    new_data = st.session_state["my_input_key"]
    st.session_state["main_data"].append(new_data)
    
    # 2. Clear the widget (LEGAL here because callback runs BEFORE body instantiation)
    st.session_state["my_input_key"] = ""

st.text_input("Add something", key="my_input_key")
st.button("Add", on_click=add_resource_callback)
```

## 3. UI Reactivity & Iframe Freshness
`st.components.v1.html` renders content inside an iframe. Streamlit identifies these elements by their position and arguments.

### Rules for `components.html`:
- **Unconditional Rendering**: Render the iframe in the main body, not inside a conditional block like `if st.button(...)`. This ensures it refreshes on every relevant rerun.
- **Content-Hash Keys (v1.55+)**: To force a fresh iframe when the content changes, wrap the component in an `st.container` with a key based on the content's hash.
```python
# Forces a fresh DOM element whenever 'current_result' changes
with st.container(key=f"render_{hash(st.session_state['current_result'])}"):
    st.components.v1.html(my_html_string)
```

## 4. Forms vs. Immediate Buttons
- **Forms**: Use `st.form` for batching multiple inputs (e.g., "Generate Directory" parameters). Values are only sent to the backend when the `st.form_submit_button` is clicked.
- **Immediate Buttons**: Use regular `st.button` for incremental or immediate actions (e.g., "Add Resource"). These trigger an immediate rerun after their callback.
- **Conflict Avoidance**: Actions outside a form (like an "Add" button) will trigger a rerun that might lose *un-submitted* form data. Ensure the "Add" logic relies on persisted state, not un-submitted form widgets.

## 5. Success/Flash Messages
Use a dedicated session state key (e.g., `st.session_state["flash"]`) to store transient success or error messages. Set the message in the callback and render/clear it in the main body.
