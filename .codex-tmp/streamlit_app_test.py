from streamlit.testing.v1 import AppTest

app = AppTest.from_file(r"C:\Users\yangd\projects\jeju-irang\app.py")
app.run(timeout=30)
assert not app.exception, [str(item.value) for item in app.exception]
assert len(app.tabs) == 2
assert len(app.dataframe) >= 2
assert len(app.selectbox) >= 2
print(
    "streamlit AppTest: OK",
    f"tabs={len(app.tabs)} dataframes={len(app.dataframe)} selectboxes={len(app.selectbox)} metrics={len(app.metric)}",
)
