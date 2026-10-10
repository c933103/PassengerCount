package app.passengercount;

import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

/** Test-side access across the distinct --no-restart instrumentation classloader. */
final class TargetAccess {
    private TargetAccess() {}
    static Object call(Object target, String name, Object... arguments) throws Exception {
        return invoke(target.getClass(), target, name, arguments);
    }
    static Object callStatic(Class<?> type, String name, Object... arguments) throws Exception {
        return invoke(type, null, name, arguments);
    }
    private static Object invoke(Class<?> type, Object target, String name, Object[] arguments) throws Exception {
        Method found = null;
        for (Method method : type.getDeclaredMethods()) {
            if (!method.getName().equals(name) || method.getParameterTypes().length != arguments.length) continue;
            Class<?>[] parameters = method.getParameterTypes();
            boolean matches = true;
            for (int i = 0; i < parameters.length; i++)
                if (arguments[i] != null && !parameters[i].isInstance(arguments[i])) matches = false;
            if (!matches) continue;
            if (found != null) throw new NoSuchMethodException("Ambiguous test access: " + name);
            found = method;
        }
        if (found == null) throw new NoSuchMethodException(type.getName() + "." + name);
        found.setAccessible(true);
        try { return found.invoke(target, arguments); }
        catch (InvocationTargetException failure) {
            Throwable cause = failure.getCause();
            if (cause instanceof Error) throw (Error) cause;
            if (cause instanceof Exception) throw (Exception) cause;
            throw new RuntimeException(cause);
        }
    }
    static Object field(Object target, String name) throws Exception {
        return field(target.getClass(), target, name);
    }
    static Object staticField(Class<?> type, String name) throws Exception {
        return field(type, null, name);
    }
    private static Object field(Class<?> type, Object target, String name) throws Exception {
        Field field = type.getDeclaredField(name);
        field.setAccessible(true);
        return field.get(target);
    }
}
