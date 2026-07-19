import { describe, expect, it } from "vitest";
import { HOME_QUICK_STARTS } from "./home-quick-starts";

describe("HOME_QUICK_STARTS", () => {
  it("has exactly three honest prompt chips", () => {
    expect(HOME_QUICK_STARTS).toEqual([
      {
        id: "todo",
        label: "待办清单",
        prompt: "做一个待办清单，支持分组与截止时间",
      },
      {
        id: "login",
        label: "登录页",
        prompt: "做一个简洁的登录页，含邮箱密码与主按钮",
      },
      {
        id: "dashboard",
        label: "数据看板",
        prompt: "做一个简单数据看板，含指标卡与图表占位",
      },
    ]);
  });
});
