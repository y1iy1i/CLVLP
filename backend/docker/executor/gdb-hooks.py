import json

import gdb


RETURN_LOG = "/tmp/clvlp-trace.returns"


class ClvlpFinishBreakpoint(gdb.FinishBreakpoint):
    def __init__(self, frame_id, function_name):
        super().__init__(gdb.newest_frame(), internal=True)
        self.silent = True
        self.frame_id = frame_id
        self.function_name = function_name

    def stop(self):
        value = self.return_value
        payload = {
            "frameId": self.frame_id,
            "function": self.function_name,
            "available": value is not None,
            "value": str(value) if value is not None else None,
            "type": str(value.type) if value is not None else "void",
        }
        with open(RETURN_LOG, "a", encoding="utf-8") as output:
            output.write(json.dumps(payload, ensure_ascii=True) + "\n")
        return False


def clvlp_arm_finish(frame_id, function_name):
    try:
        ClvlpFinishBreakpoint(frame_id, function_name)
        return True
    except gdb.error:
        return False
