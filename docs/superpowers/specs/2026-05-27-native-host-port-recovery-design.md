# Native Host 端口恢复设计

## 背景

当前扩展连接 native host 后会直接发送 `START`，native server 随后直接监听 `127.0.0.1:12306`。当本机已有旧的 `chromemcp/native-server` 进程残留时，会触发 `EADDRINUSE`，并把错误透传到扩展错误页。

## 目标

在不误杀无关进程的前提下，让 native server 在启动前具备以下能力：

1. 如果 `12306` 上已经是一个健康的本项目 companion 服务，直接复用，不重复监听。
2. 如果 `12306` 被占用，但占用者是本项目遗留的 native server 进程，则定向清理后重试启动一次。
3. 如果既不是健康 companion，也不是可识别的本项目旧进程，则保留原始错误，避免误伤其他程序。

## 方案

在 `apps/native-server/src/server/index.ts` 的启动逻辑前增加一个端口恢复步骤：

1. 先探测 `http://127.0.0.1:<port>/discovery`。
2. 如果返回结构可识别且服务可用，则直接标记为运行中并跳过 `listen`。
3. 如果探测失败，再识别当前端口占用进程是否为 `chromemcp/native-server` 安装目录下的 `index.js` 或对应 wrapper 启动的 Node 进程。
4. 只对识别到的本项目旧进程执行终止，并再次尝试 `listen`。

## 边界

1. 不做“按端口无差别 kill”。
2. 不改动扩展侧消息协议。
3. 不引入新的用户可配置端口逻辑。

## 测试

1. 探测到健康 companion 时，应跳过 `fastify.listen`。
2. 遇到可识别旧进程时，应执行清理并成功重试。
3. 遇到不可识别占用者时，应继续抛出 `EADDRINUSE`。
