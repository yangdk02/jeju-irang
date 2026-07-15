class _Context:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def metric(self, *_args, **_kwargs):
        return None


class _Sidebar(_Context):
    pass


sidebar = _Sidebar()


def cache_data(*_args, **_kwargs):
    def decorator(func):
        return func
    return decorator


def set_page_config(*_args, **_kwargs): pass
def markdown(*_args, **_kwargs): pass
def write(*_args, **_kwargs): pass
def caption(*_args, **_kwargs): pass
def dataframe(*_args, **_kwargs): pass
def image(*_args, **_kwargs): pass
def info(*_args, **_kwargs): pass
def error(*_args, **_kwargs): pass
def success(*_args, **_kwargs): pass
def warning(*_args, **_kwargs): pass
def stop(): raise SystemExit(1)
def tabs(names): return [_Context() for _ in names]
def columns(spec, **_kwargs): return [_Context() for _ in range(spec if isinstance(spec, int) else len(spec))]
def radio(_label, options, **_kwargs): return options[0]
def text_input(*_args, **_kwargs): return ""
def multiselect(*_args, **_kwargs): return []
def checkbox(*_args, **_kwargs): return False
def selectbox(_label, options, **_kwargs): return list(options)[0]
def form(*_args, **_kwargs): return _Context()
def form_submit_button(*_args, **_kwargs): return False
